import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, JwtPayload } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators';
import { MessagesService, SendMessageDto } from './messages.service';

@Controller('system/messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly service: MessagesService) {}

  // POST /api/system/messages
  @Post()
  send(@Body() dto: SendMessageDto, @CurrentUser() user: JwtPayload) {
    if (!user?.sub) throw new BadRequestException('Authentication required');
    return this.service.sendMessage(user.sub, dto);
  }
}
