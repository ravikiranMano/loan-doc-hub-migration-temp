import { BadRequestException, Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators';
import { JwtPayload } from '../../common/guards/jwt-auth.guard';
import { GenerationService } from './generation.service';

export class GenerateV1Dto {
  templateId!: string;
  outputType?: string;
}

@Controller('generation')
@UseGuards(JwtAuthGuard)
export class GenerationController {
  constructor(private readonly service: GenerationService) {}

  // POST /api/generation/deals/:dealId/generate
  @Post('deals/:dealId/generate')
  generate(
    @Param('dealId') dealId: string,
    @Body() dto: GenerateV1Dto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!dto.templateId) throw new BadRequestException('templateId is required');
    if (!user?.sub) throw new BadRequestException('Authentication required');
    return this.service.generate(dealId, dto.templateId, user.sub, dto.outputType);
  }
}
