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
      { findByHumlinker: jest.fn(async () => []), create: jest.fn() } as never,
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
