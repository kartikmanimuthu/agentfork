import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { env } from '../env';

let cognitoClient: CognitoIdentityProviderClient | null = null;

export function getCognitoClient(): CognitoIdentityProviderClient {
  if (!cognitoClient) {
    cognitoClient = new CognitoIdentityProviderClient({
      region: env.AWS_REGION,
    });
  }
  return cognitoClient;
}

function parsePoolIdFromIssuer(issuer: string): string | null {
  try {
    const url = new URL(issuer);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[0] ?? null;
  } catch {
    return null;
  }
}

export const COGNITO_USER_POOL_ID =
  env.COGNITO_USER_POOL_ID ||
  (env.COGNITO_ISSUER ? parsePoolIdFromIssuer(env.COGNITO_ISSUER) : '') ||
  '';
