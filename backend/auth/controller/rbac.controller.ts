// backend/auth/controller/rbac.controller.ts
import { Controller, Post, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
import { RoleService } from '../rbac/role.service';
import { RequirePermission } from '../middleware/permissions.decorator';
import { PermissionGuard } from '../middleware/permission.guard';

@Controller('auth/rbac')
@UseGuards(PermissionGuard)
export class RbacController {
  constructor(private readonly roleService: RoleService) {}

  /**
   * Delete a role (Edge case fallback handled inside service)
   */
  @Delete('roles/:id')
  @RequirePermission('settings:admin')
  async removeRole(@Param('id') id: string) {
    await this.roleService.deleteRole(id);
    return { message: 'Role deleted successfully and assigned users fell back to Viewer.' };
  }

  /**
   * Assign a role to a user (Escalation prevention checked inside service)
   */
  @Post('users/assign')
  @RequirePermission('settings:admin')
  async assignRole(
    @Req() req: any, 
    @Body() body: { userId: string; roleId: string }
  ) {
    // req.user.id is populated by your authentication layer passport/JWT strategy
    const actorId = req.user.id; 
    
    const assignment = await this.roleService.assignRoleToUser(
      actorId,
      body.userId,
      body.roleId
    );
    
    return {
      message: 'Role assigned successfully without escalation.',
      data: assignment,
    };
  }
}