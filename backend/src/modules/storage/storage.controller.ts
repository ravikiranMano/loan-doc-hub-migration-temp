import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Body,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { StorageService } from './storage.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MAX_UPLOAD_FILE_BYTES } from '../../common/constants/limits.constants';
import { DEFAULT_SIGNED_URL_TTL_SECONDS } from '../../common/constants/storage.constants';
import { parseOptionalPositiveInt } from '../../common/helpers/query-params';

@Controller('storage')
@UseGuards(JwtAuthGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  /**
   * Upload a file to the given bucket.
   * Frontend: POST /api/storage/:bucket/upload?path=folder/file.pdf
   */
  @Post(':bucket/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_FILE_BYTES } }))
  async upload(
    @Param('bucket') bucket: string,
    @Query('path') path: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('upsert') upsert?: string,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    if (!path) throw new BadRequestException('Query param "path" is required');

    return this.storageService.upload(
      bucket,
      path,
      file.buffer,
      file.mimetype,
      upsert === 'true',
    );
  }

  /**
   * Download a file — streamed back to the client.
   * Frontend: GET /api/storage/:bucket/file/folder/file.pdf
   */
  @Get(':bucket/file/*')
  async download(
    @Param('bucket') bucket: string,
    @Param('0') rawPath: string,
    @Res() res: Response,
  ) {
    const path = normalizeStorageObjectPath(rawPath);
    const { buffer, contentType } = await this.storageService.download(bucket, path);
    const filename = path.split('/').pop() ?? 'download';

    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }

  /**
   * Get a signed URL for direct client access (e.g. PDF preview).
   * Frontend: GET /api/storage/:bucket/signed?path=folder/file.pdf&expires=3600
   */
  @Get(':bucket/signed')
  async signedUrl(
    @Param('bucket') bucket: string,
    @Query('path') path: string,
    @Query('expires') expires?: string,
  ) {
    if (!path) throw new BadRequestException('Query param "path" is required');
    const expiresIn = parseOptionalPositiveInt(expires) ?? DEFAULT_SIGNED_URL_TTL_SECONDS;
    const url = await this.storageService.getSignedUrl(bucket, path, expiresIn);
    return { url };
  }

  /**
   * Remove one or more files from a bucket.
   * Frontend: DELETE /api/storage/:bucket/remove  body: { paths: string[] }
   */
  @Delete(':bucket/remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('bucket') bucket: string, @Body() body: { paths: string[] }) {
    if (!body?.paths?.length) throw new BadRequestException('"paths" array is required');
    return this.storageService.remove(bucket, body.paths);
  }
}

/** Decode legacy %2F-encoded paths and trim leading slashes. */
function normalizeStorageObjectPath(rawPath: string): string {
  let path = rawPath ?? '';
  try {
    if (path.includes('%')) {
      path = decodeURIComponent(path);
    }
  } catch {
    // keep raw path when malformed encoding
  }
  return path.replace(/^\/+/, '');
}
