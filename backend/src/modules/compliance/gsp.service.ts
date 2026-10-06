import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { SandboxGsp, type GspProvider } from './gsp';

/** Holds the configured GSP adapter. */
@Injectable()
export class GspService {
  readonly provider: GspProvider;

  constructor(config: ConfigService<Env, true>) {
    const name = config.get('GSP_PROVIDER', { infer: true });
    // Only the sandbox ships today; production adapters plug in here by name.
    this.provider = name === 'sandbox' ? new SandboxGsp() : new SandboxGsp();
  }
}
