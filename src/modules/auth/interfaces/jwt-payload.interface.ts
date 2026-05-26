export interface JwtPayload {
  userId: string;
  role: 'user' | 'admin';
}

export interface AuthenticatedUser {
  userId: string;
  role: 'user' | 'admin';
}
