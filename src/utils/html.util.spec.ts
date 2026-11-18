import { escapeHtml, singleLine } from './html.util';
import { toPublicUser } from './user.util';
import type { User } from '../modules/users/entities';

describe('escapeHtml', () => {
  it('neutralise les balises et attributs injectés', () => {
    expect(escapeHtml('<a href="https://phishing.example">Cliquez</a>')).toBe(
      '&lt;a href=&quot;https://phishing.example&quot;&gt;Cliquez&lt;/a&gt;',
    );
  });

  it('gère null / undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('singleLine', () => {
  it('supprime les retours à la ligne (injection d’en-têtes)', () => {
    expect(singleLine('Jean\r\nBcc: victime@example.com')).toBe(
      'Jean Bcc: victime@example.com',
    );
  });
});

describe('toPublicUser', () => {
  it("n'expose ni email ni téléphone", () => {
    const user = {
      _id: 'id',
      pin: 'ABCD2345',
      firstName: 'Jean',
      lastName: 'Dupont',
      profilePicture: null,
      email: 'jean@example.com',
      phoneNumber: '+33600000000',
      passwordHash: 'hash',
    } as unknown as User;

    const pub = toPublicUser(user);
    expect(pub).toEqual({
      _id: 'id',
      pin: 'ABCD2345',
      firstName: 'Jean',
      lastName: 'Dupont',
      profilePicture: null,
    });
    expect(pub).not.toHaveProperty('email');
    expect(pub).not.toHaveProperty('phoneNumber');
  });
});
