import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../auth/services/token.service';
import { PersonalSavedViewsService } from './personal-saved-views.service';

/**
 * Personal preferences only. JWT is the ownership boundary: no ownerId, roleId
 * or tenantId is accepted from request data. Applying a saved filter never
 * bypasses the domain PDP that reads actual Work Inbox / Finance records.
 */
@Controller('personalization/saved-views')
@UseGuards(JwtAuthGuard)
export class PersonalSavedViewsController {
  constructor(private readonly savedViews: PersonalSavedViewsService) {}

  @Get(':viewKey')
  list(@CurrentAuth() auth: AccessTokenClaims, @Param('viewKey') viewKey: string) {
    return this.savedViews.list(auth.sub, viewKey);
  }

  @Post(':viewKey')
  save(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('viewKey') viewKey: string,
    @Body() body: unknown,
  ) {
    return this.savedViews.save(auth.sub, viewKey, body);
  }

  @Delete(':viewKey/:id')
  remove(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('viewKey') viewKey: string,
    @Param('id') id: string,
  ) {
    return this.savedViews.remove(auth.sub, viewKey, id);
  }
}
