import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AccessModule } from './common/access.module';
import { AuthGuard, PermissionsGuard } from './common/guards';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { validateEnv, type Env } from './config/env';
import { DatabaseModule } from './database/database.module';
import { AccountModule } from './modules/account/account.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { SubscriptionGuard } from './modules/billing/subscription.guard';
import { CustomizationModule } from './modules/customization/customization.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { HealthController } from './modules/health/health.controller';
import { IamModule } from './modules/iam/iam.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ImportsModule } from './modules/imports/imports.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { MastersModule } from './modules/masters/masters.module';
import { OrgModule } from './modules/org/org.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { PurchaseModule } from './modules/purchase/purchase.module';
import { SalesModule } from './modules/sales/sales.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { JobWorkModule } from './modules/jobwork/jobwork.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { ManufacturingModule } from './modules/manufacturing/manufacturing.module';
import { QualityModule } from './modules/quality/quality.module';
import { ReportsModule } from './modules/reports/reports.module';
import { DashboardsModule } from './modules/dashboards/dashboards.module';
import { CopilotModule } from './modules/copilot/copilot.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { EngineeringModule } from './modules/engineering/engineering.module';
import { HrModule } from './modules/hr/hr.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { CrmModule } from './modules/crm/crm.module';
import { DmsModule } from './modules/dms/dms.module';
import { PortalModule } from './modules/portal/portal.module';
import { AgentsModule } from './modules/agents/agents.module';
import { VoiceModule } from './modules/voice/voice.module';
import { TmsModule } from './modules/tms/tms.module';
import { WmsModule } from './modules/wms/wms.module';
import { ServiceModule } from './modules/service/service.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { QmsModule } from './modules/qms/qms.module';
import { PlanningModule } from './modules/planning/planning.module';
import { ProcessModule } from './modules/process/process.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { issuer: 'nextgen-erp' },
        verifyOptions: { issuer: 'nextgen-erp' },
      }),
    }),
    DatabaseModule,
    AccessModule,
    JobsModule,
    AuditModule,
    NotificationsModule,
    BillingModule,
    IntegrationsModule,
    AuthModule,
    IamModule,
    AccountModule,
    OrgModule,
    DocumentsModule,
    CustomizationModule,
    MastersModule,
    InventoryModule,
    ImportsModule,
    PurchaseModule,
    SalesModule,
    ComplianceModule,
    JobWorkModule,
    AccountingModule,
    ManufacturingModule,
    QualityModule,
    ReportsModule,
    DashboardsModule,
    CopilotModule,
    OnboardingModule,
    ProcessModule,
    PlanningModule,
    EngineeringModule,
    QmsModule,
    MaintenanceModule,
    HrModule,
    PayrollModule,
    CrmModule,
    DmsModule,
    ServiceModule,
    PortalModule,
    WmsModule,
    TmsModule,
    AgentsModule,
    VoiceModule,
    AdminModule,
    PrivacyModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: SubscriptionGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
