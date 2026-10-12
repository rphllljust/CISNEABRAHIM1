import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermanentJobError, TransientJobError } from '../../platform/background-jobs/domain/job-errors';
import { NOTIFICATION_CHANNELS } from '../domain/notification-channel';
import {
  NotificationsRepository,
  type DeliveryAttemptRow,
  type RecordDeliveryAttemptInput,
} from '../repositories/notifications.repository';
import { NotificationChannelRegistry } from '../services/notification-channel.registry';
import { NotificationDeliveryService } from '../services/notification-delivery.service';
import { NotificationTemplateService } from '../services/notification-template.service';
import { ControllableNotificationChannelProvider } from '../testing/controllable-channel.provider';

describe('NotificationDeliveryService', () => {
  let service: NotificationDeliveryService;
  let repository: {
    findIntentById: ReturnType<typeof vi.fn>;
    markIntentDispatched: ReturnType<typeof vi.fn>;
    getOrCreateNotification: ReturnType<typeof vi.fn>;
    findAcceptedAttempt: ReturnType<typeof vi.fn>;
    countAttempts: ReturnType<typeof vi.fn>;
    recordDeliveryAttempt: ReturnType<typeof vi.fn<NotificationsRepository['recordDeliveryAttempt']>>;
    updateNotificationStatus: ReturnType<typeof vi.fn>;
  };
  let registry: NotificationChannelRegistry;
  let inAppProvider: ControllableNotificationChannelProvider;

  const intentId = '11111111-1111-4111-8111-111111111111';
  const notificationId = '22222222-2222-4222-8222-222222222222';

  const pendingIntent = {
    id: intentId,
    domain_event_id: '33333333-3333-4333-8333-333333333333',
    intent_key: 'test-intent',
    audience_scope: 'UNIT_OPERATIONS',
    template_key: 'test.template',
    payload: { schemaVersion: 1 },
    status: 'PENDING',
  };

  beforeEach(async () => {
    repository = {
      findIntentById: vi.fn(),
      markIntentDispatched: vi.fn(),
      getOrCreateNotification: vi.fn(),
      findAcceptedAttempt: vi.fn(),
      countAttempts: vi.fn(),
      recordDeliveryAttempt: vi.fn<NotificationsRepository['recordDeliveryAttempt']>(),
      updateNotificationStatus: vi.fn(),
    };
    registry = new NotificationChannelRegistry();
    inAppProvider = new ControllableNotificationChannelProvider(NOTIFICATION_CHANNELS.InApp);
    registry.register(inAppProvider);

    const module = await Test.createTestingModule({
      providers: [
        NotificationDeliveryService,
        NotificationTemplateService,
        NotificationChannelRegistry,
        { provide: NotificationsRepository, useValue: repository },
        {
          provide: 'NOTIFICATION_CHANNEL_REGISTRY_INIT',
          useFactory: () => {
            registry.register(inAppProvider);
            return registry;
          },
        },
      ],
    })
      .overrideProvider(NotificationChannelRegistry)
      .useValue(registry)
      .compile();

    service = module.get(NotificationDeliveryService);
    repository.findIntentById.mockResolvedValue(pendingIntent);
    repository.markIntentDispatched.mockResolvedValue(true);
    repository.getOrCreateNotification.mockResolvedValue({
      id: notificationId,
      notification_intent_id: intentId,
      channel: NOTIFICATION_CHANNELS.InApp,
      recipient_ref: 'audience:UNIT_OPERATIONS',
      template_key: 'test.template',
      status: 'PENDING',
      created_at: new Date().toISOString(),
    });
    repository.findAcceptedAttempt.mockResolvedValue(null);
    repository.countAttempts.mockResolvedValue(0);
    repository.recordDeliveryAttempt.mockImplementation(async (input: RecordDeliveryAttemptInput): Promise<DeliveryAttemptRow> => ({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      notification_id: input.notificationId,
      channel: input.channel,
      recipient_ref: input.recipientRef,
      provider: input.provider,
      attempt: input.attempt,
      status: input.status,
      provider_message_id: input.providerMessageId ?? null,
      sent_at: input.sentAt ?? null,
      delivered_at: input.deliveredAt ?? null,
      failure_code: input.failureCode ?? null,
      created_at: new Date().toISOString(),
    }));
    repository.updateNotificationStatus.mockResolvedValue(undefined);
  });

  it('dispatches successfully through IN_APP', async () => {
    const result = await service.dispatchNotificationIntent(intentId);

    expect(result.channelsAttempted).toEqual([NOTIFICATION_CHANNELS.InApp]);
    expect(inAppProvider.dispatchCount).toBe(1);
    expect(repository.recordDeliveryAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'DELIVERED',
      }),
    );
    expect(repository.markIntentDispatched).toHaveBeenCalledWith(intentId);
  });

  it('throws TransientJobError on transient provider failure', async () => {
    inAppProvider.behavior = 'transient';

    await expect(service.dispatchNotificationIntent(intentId)).rejects.toBeInstanceOf(TransientJobError);
    expect(repository.recordDeliveryAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'FAILED', failureCode: 'SIMULATED_TRANSIENT' }),
    );
    expect(repository.markIntentDispatched).not.toHaveBeenCalled();
  });

  it('records permanent failure without retrying dispatch at job level for permanent errors', async () => {
    inAppProvider.behavior = 'permanent';

    await service.dispatchNotificationIntent(intentId);

    expect(repository.recordDeliveryAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'FAILED', failureCode: 'SIMULATED_PERMANENT' }),
    );
    expect(repository.markIntentDispatched).toHaveBeenCalled();
  });

  it('retries only channels that failed transiently on a subsequent attempt', async () => {
    inAppProvider.behavior = 'transient';
    await expect(service.dispatchNotificationIntent(intentId)).rejects.toBeInstanceOf(TransientJobError);
    expect(inAppProvider.dispatchCount).toBe(1);

    inAppProvider.behavior = 'success';
    repository.countAttempts.mockResolvedValue(1);
    await service.dispatchNotificationIntent(intentId);
    expect(inAppProvider.dispatchCount).toBe(2);
    expect(repository.markIntentDispatched).toHaveBeenCalled();
  });

  it('does not re-dispatch when provider already accepted the message', async () => {
    repository.findAcceptedAttempt.mockResolvedValue({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      notification_id: notificationId,
      channel: NOTIFICATION_CHANNELS.InApp,
      recipient_ref: 'audience:UNIT_OPERATIONS',
      provider: 'in-app',
      attempt: 1,
      status: 'DELIVERED',
      provider_message_id: 'accepted-msg-1',
      sent_at: new Date().toISOString(),
      delivered_at: new Date().toISOString(),
      failure_code: null,
      created_at: new Date().toISOString(),
    });

    await service.dispatchNotificationIntent(intentId);

    expect(inAppProvider.dispatchCount).toBe(0);
    expect(repository.markIntentDispatched).toHaveBeenCalled();
  });

  it('fails permanently for invalid recipient on external channels', async () => {
    const emailProvider = new ControllableNotificationChannelProvider(NOTIFICATION_CHANNELS.Email);
    registry.register(emailProvider);
    process.env['EMAIL_NOTIFICATION_CONFIGURED'] = 'true';
    process.env['EMAIL_PROVIDER_ID'] = 'test-email';

    repository.findIntentById.mockResolvedValue({
      ...pendingIntent,
      payload: { schemaVersion: 1 },
    });

    await service.dispatchNotificationIntent(intentId);

    expect(repository.recordDeliveryAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: NOTIFICATION_CHANNELS.Email,
        failureCode: 'INVALID_RECIPIENT',
      }),
    );

    delete process.env['EMAIL_NOTIFICATION_CONFIGURED'];
    delete process.env['EMAIL_PROVIDER_ID'];
  });

  it('classifies provider timeout as transient', async () => {
    inAppProvider.behavior = 'timeout';

    await expect(service.dispatchNotificationIntent(intentId)).rejects.toBeInstanceOf(TransientJobError);
    expect(repository.recordDeliveryAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: 'SIMULATED_TIMEOUT' }),
    );
  });

  it('returns already dispatched for duplicate job processing', async () => {
    repository.findIntentById.mockResolvedValue({ ...pendingIntent, status: 'DISPATCHED' });

    const result = await service.dispatchNotificationIntent(intentId);

    expect(result.alreadyDispatched).toBe(true);
    expect(inAppProvider.dispatchCount).toBe(0);
  });

  it('throws PermanentJobError when intent is missing', async () => {
    repository.findIntentById.mockResolvedValue(null);
    await expect(service.dispatchNotificationIntent(intentId)).rejects.toBeInstanceOf(PermanentJobError);
  });
});

describe('NotificationTemplateService', () => {
  const templateService = new NotificationTemplateService();

  it('builds minimal template variables without sensitive payload fields', () => {
    const variables = templateService.buildMinimalVariables({
      intentKey: 'billing-ready-notice',
      audienceScope: 'UNIT_FINANCE',
      templateKey: 'billing.ready.notice',
      payload: {
        schemaVersion: 1,
        customerTaxId: '12345678901',
        amountCents: 99999,
      },
    });

    expect(variables).toEqual({
      templateKey: 'billing.ready.notice',
      intentKey: 'billing-ready-notice',
      schemaVersion: '1',
    });
    expect(variables['customerTaxId']).toBeUndefined();
    expect(variables['amountCents']).toBeUndefined();
  });
});
