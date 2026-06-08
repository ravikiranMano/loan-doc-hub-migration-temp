import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  ALLOWED_STORAGE_BUCKETS,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
} from '../../common/constants/storage.constants';

/**
 * Server-side Supabase Storage proxy.
 *
 * Uses the service_role key so uploads/downloads bypass RLS — all access
 * control is enforced by NestJS guards before reaching this service.
 * autoRefreshToken and persistSession are disabled because this is a
 * long-lived server process with no browser session to manage.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly supabase: SupabaseClient;

  constructor(private readonly config: ConfigService) {
    const url = config.getOrThrow<string>('supabase.url');
    const key = config.getOrThrow<string>('supabase.serviceRoleKey');
    this.supabase = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  private validateBucket(bucket: string) {
    if (!ALLOWED_STORAGE_BUCKETS.has(bucket)) {
      throw new BadRequestException(`Unknown storage bucket: ${bucket}`);
    }
  }

  async upload(
    bucket: string,
    path: string,
    buffer: Buffer,
    mimetype: string,
    upsert = false,
  ): Promise<{ path: string }> {
    this.validateBucket(bucket);

    const { data, error } = await this.supabase.storage
      .from(bucket)
      .upload(path, buffer, { contentType: mimetype, upsert });

    if (error) {
      this.logger.error(`Storage upload failed: ${bucket}/${path} — ${error.message}`);
      throw new BadRequestException(error.message);
    }

    return { path: data.path };
  }

  async download(bucket: string, path: string): Promise<{ buffer: Buffer; contentType: string }> {
    this.validateBucket(bucket);

    const { data, error } = await this.supabase.storage.from(bucket).download(path);

    if (error) {
      this.logger.error(`Storage download failed: ${bucket}/${path} — ${error.message}`);
      throw new NotFoundException(`File not found: ${path}`);
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    const contentType = data.type || 'application/octet-stream';
    return { buffer, contentType };
  }

  async remove(bucket: string, paths: string[]): Promise<void> {
    this.validateBucket(bucket);

    const { error } = await this.supabase.storage.from(bucket).remove(paths);

    if (error) {
      this.logger.error(`Storage remove failed: ${bucket} — ${error.message}`);
      throw new BadRequestException(error.message);
    }
  }

  async getSignedUrl(
    bucket: string,
    path: string,
    expiresInSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS,
  ): Promise<string> {
    this.validateBucket(bucket);

    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds);

    if (error) throw new BadRequestException(error.message);
    return data.signedUrl;
  }
}
