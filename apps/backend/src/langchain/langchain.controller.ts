import {
  BadRequestException,
  Body,
  Controller,
  InternalServerErrorException,
  Post,
} from '@nestjs/common';
import { LangchainService } from './langchain.service.js';

@Controller('langchain')
export class LangchainController {
  constructor(private readonly langchainService: LangchainService) {}

  @Post('ask')
  async askTheAgent(@Body() { question }: { question: string }): Promise<any> {
    if (!question?.trim()) {
      throw new BadRequestException(
        'Query parameter "question" is required and cannot be empty.',
      );
    }

    try {
      const answer = await this.langchainService.ask(question);
      return {
        question: question,
        answer: answer,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error interacting with AI Agent:', error);
      throw new InternalServerErrorException(
        `Sorry, an error occurred while processing your request. Please try again later.`,
      );
    }
  }
}
