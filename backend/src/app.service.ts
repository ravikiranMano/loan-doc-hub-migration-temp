import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getRoot() {
    return { message: 'Loan Doc Hub API is running' };
  }
}
