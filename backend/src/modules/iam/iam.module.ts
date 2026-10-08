import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IamController } from './iam.controller';
import { InvitationsService } from './invitations.service';
import { PublicInvitationsController } from './public-invitations.controller';
import { RolesService } from './roles.service';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule],
  controllers: [IamController, PublicInvitationsController],
  providers: [UsersService, InvitationsService, RolesService],
  exports: [InvitationsService],
})
export class IamModule {}
