import { Global, Module } from '@nestjs/common';
import { AccessCacheService } from './access-cache.service';
import { CryptoService } from './crypto.service';

@Global()
@Module({
  providers: [AccessCacheService, CryptoService],
  exports: [AccessCacheService, CryptoService],
})
export class AccessModule {}
