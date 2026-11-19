import { MessagesService } from './messages.service';

/**
 * Régression : l'IA lisait la langue du Sender dans la « photo » figée du
 * humlinker (prise à sa création). Changer sa langue dans le profil n'avait
 * aucun effet : objectif en français alors que le profil était en anglais.
 */
describe('MessagesService.sendMessage — profils actuels transmis à l’IA', () => {
  const snapshot = (name: string, language: string) => ({
    userId: name,
    firstName: name,
    lastName: null,
    email: null,
    language,
    gender: null,
    profilePicture: null,
    isPlaceholder: false,
  });

  const humlinker = {
    _id: 'h1',
    senderId: 'aaron',
    targetId: 'marco',
    isInitiator: true,
    status: 'active',
    relationshipType: 'ami',
    // Photos prises à la création : tout le monde en français
    sender: snapshot('Aaron', 'fr'),
    target: snapshot('Marco', 'fr'),
  };

  const liveUser = (id: string, language: string, extra: object = {}) => ({
    _id: id,
    firstName: id === 'aaron' ? 'Aaron' : 'Marco',
    lastName: 'Test',
    language,
    gender: 'male',
    isPlaceholder: false,
    ...extra,
  });

  let users: Record<string, any>;
  let aiContext: any;
  let service: MessagesService;

  beforeEach(() => {
    users = {};
    aiContext = undefined;
    const ai = {
      processUserMessage: jest.fn(async (ctx: unknown) => {
        aiContext = ctx;
        return {
          objectiveMessage: 'You would like to…',
          realMessage: 'Aaron would like…',
          draftChanged: true,
          notice: null,
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }),
    };
    service = new MessagesService(
      { findById: jest.fn(async () => humlinker) } as never,
      {
        findByHumlinker: jest.fn(async () => []),
        findBetween: jest.fn(async () => []),
        create: jest.fn(),
      },
      {
        findLastSentDrafts: jest.fn(async () => []),
        findActiveDraft: jest.fn(async () => null),
        create: jest.fn(async (d: object) => ({
          _id: 'd1',
          isSent: false,
          createdAt: new Date(),
          ...d,
        })),
      } as never,
      { findById: jest.fn(async (id: string) => users[id] ?? null) } as never,
      ai as never,
      {} as never,
      {} as never,
      {
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        incrWithTtl: jest.fn(),
      } as never,
      {
        assertCanUse: jest.fn(),
        assertAiBudget: jest.fn(),
        recordAi: jest.fn(),
        recordAiCostOnly: jest.fn(),
      } as never,
      { app: {} } as never,
    );
    (service as any).pushDraftVersion = jest.fn();
  });

  it('utilise la langue ACTUELLE du profil du Sender (pas celle de la création)', async () => {
    users.aaron = liveUser('aaron', 'en');
    users.marco = liveUser('marco', 'fr');
    await service.sendMessage('h1', 'aaron', 'hello');
    expect(aiContext).toMatchObject({
      senderLanguage: 'en',
      senderGender: 'male',
      senderName: 'Aaron Test',
      targetLanguage: 'fr',
      targetName: 'Marco Test',
    });
  });

  it('utilise la langue actuelle du destinataire inscrit', async () => {
    users.aaron = liveUser('aaron', 'fr');
    users.marco = liveUser('marco', 'he');
    await service.sendMessage('h1', 'aaron', 'salut');
    expect(aiContext.targetLanguage).toBe('he');
  });

  it('destinataire sans compte : langue choisie à la création du humlinker', async () => {
    users.aaron = liveUser('aaron', 'fr');
    users.marco = liveUser('marco', 'de', { isPlaceholder: true });
    await service.sendMessage('h1', 'aaron', 'salut');
    expect(aiContext.targetLanguage).toBe('fr');
  });
});

describe('MessagesService — effacer la discussion (de son côté)', () => {
  const cleared = new Date('2026-11-19T12:00:00Z');
  let humlinker: any;
  let findByHumlinker: jest.Mock;
  let update: jest.Mock;
  let service: MessagesService;

  beforeEach(() => {
    humlinker = {
      _id: 'h1',
      senderId: 'aaron',
      targetId: 'marco',
      isInitiator: true,
      status: 'active',
      relationshipType: 'ami',
      historyClearedAt: cleared,
      sender: {
        firstName: 'Aaron',
        lastName: null,
        language: 'fr',
        gender: null,
      },
      target: {
        firstName: 'Marco',
        lastName: null,
        language: 'fr',
        gender: null,
      },
    };
    findByHumlinker = jest.fn(async () => []);
    update = jest.fn(async () => humlinker);
    service = new MessagesService(
      { findById: jest.fn(async () => humlinker), update } as never,
      {
        findByHumlinker,
        findBetween: jest.fn(async () => []),
        create: jest.fn(),
      },
      {
        findLastSentDrafts: jest.fn(async () => []),
        findActiveDraft: jest.fn(async () => null),
        create: jest.fn(async (d: object) => ({
          _id: 'd1',
          isSent: false,
          createdAt: new Date(),
          ...d,
        })),
      } as never,
      { findById: jest.fn(async () => null) } as never,
      {
        processUserMessage: jest.fn(async () => ({
          objectiveMessage: 'Vous souhaitez…',
          realMessage: 'Aaron souhaite…',
          draftChanged: true,
          notice: null,
          usage: { inputTokens: 1, outputTokens: 1 },
        })),
      } as never,
      {} as never,
      {} as never,
      { get: jest.fn(), set: jest.fn(), del: jest.fn() } as never,
      {
        assertCanUse: jest.fn(),
        assertAiBudget: jest.fn(),
        recordAi: jest.fn(),
        recordAiCostOnly: jest.fn(),
      } as never,
      { app: {} } as never,
    );
    (service as any).pushDraftVersion = jest.fn();
    (service as any).listDraftVersionObjectives = jest.fn(async () => []);
  });

  it('l’écran ne charge plus que les messages postérieurs à l’effacement', async () => {
    await service.getChat('h1', 'aaron');
    expect(findByHumlinker).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({ after: cleared }),
    );
  });

  it('l’IA reçoit toujours les anciens messages comme contexte', async () => {
    await service.sendMessage('h1', 'aaron', 'bonjour');
    const aiCall = findByHumlinker.mock.calls[0];
    expect(aiCall[1]).toEqual({ limit: 50 });
    expect(aiCall[1]).not.toHaveProperty('after');
  });

  it('enregistre la date d’effacement sur son propre côté', async () => {
    const r = await service.clearHistory('h1', 'aaron');
    expect(update).toHaveBeenCalledWith('h1', {
      historyClearedAt: r.historyClearedAt,
    });
  });

  it('interdit d’effacer le côté de l’autre participant', async () => {
    await expect(service.clearHistory('h1', 'marco')).rejects.toThrow(
      'propre fil',
    );
    expect(update).not.toHaveBeenCalled();
  });
});

describe('MessagesService — résumé des longues conversations', () => {
  const msg = (i: number) => ({
    _id: `m${i}`,
    type: 'text',
    content: `message ${i}`,
    createdAt: new Date(2026, 0, 1, 0, i),
  });
  let findBetween: jest.Mock;
  let update: jest.Mock;
  let summarize: jest.Mock;
  let recordAiCostOnly: jest.Mock;
  let service: MessagesService;

  beforeEach(() => {
    findBetween = jest.fn(async () =>
      Array.from({ length: 12 }, (_, i) => msg(i)),
    );
    update = jest.fn();
    summarize = jest.fn(async () => ({
      summary: 'Résumé des échanges',
      usage: { inputTokens: 10, outputTokens: 5 },
    }));
    recordAiCostOnly = jest.fn();
    service = new MessagesService(
      { update } as never,
      { findBetween } as never,
      {} as never,
      {} as never,
      { summarizeHistory: summarize } as never,
      {} as never,
      {} as never,
      {} as never,
      { recordAiCostOnly } as never,
      { app: {} } as never,
    );
  });

  const humlinker = {
    _id: 'h1',
    contextSummary: 'Ancien résumé',
    contextSummaryUntil: new Date(2025, 0, 1),
  } as never;

  it('fenêtre pleine (50 messages) → résume les messages plus anciens', async () => {
    const window = Array.from({ length: 50 }, (_, i) => msg(100 + i));
    await service.refreshContextSummary(
      humlinker,
      window as never,
      'A',
      'B',
      'fr',
    );
    expect(findBetween).toHaveBeenCalledWith(
      'h1',
      new Date(2025, 0, 1),
      window[0].createdAt,
      200,
    );
    expect(summarize).toHaveBeenCalledWith(
      expect.objectContaining({ previousSummary: 'Ancien résumé' }),
    );
    expect(update).toHaveBeenCalledWith('h1', {
      contextSummary: 'Résumé des échanges',
      contextSummaryUntil: msg(11).createdAt,
    });
    expect(recordAiCostOnly).toHaveBeenCalled();
  });

  it('conversation courte → aucun appel', async () => {
    await service.refreshContextSummary(
      humlinker,
      [msg(1)] as never,
      'A',
      'B',
      'fr',
    );
    expect(findBetween).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
  });

  it('un échec du résumé ne casse rien', async () => {
    summarize.mockRejectedValue(new Error('Gemini KO'));
    const window = Array.from({ length: 50 }, (_, i) => msg(100 + i));
    await expect(
      service.refreshContextSummary(humlinker, window as never, 'A', 'B', 'fr'),
    ).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });
});
