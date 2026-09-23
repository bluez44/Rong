import { Controller, Get, UseGuards, Request } from "@nestjs/common";
import { JwtAuthGuard } from "./auth/jwt-auth.guard.js";

@Controller()
export class AppController {

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req: any) {
    return req.user;
  }
}