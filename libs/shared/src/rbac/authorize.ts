import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { SUBJECT_TO_MODULE, ACTION_MAP, type Module, type Action, type PredefinedRole } from './types';
import { hasPermission } from './permissions';

const PREDEFINED_ROLES = new Set<string>(['Owner', 'Admin', 'Member', 'Viewer']);

export async function authorize(
  action: string,
  subjectType: string,
  authOptions: any,
): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { error: 'Unauthenticated', message: 'No valid session' },
      { status: 401 },
    );
  }

  if (session.user.isSuperAdmin === true) return null;

  const role = session.user.role;
  if (!role) {
    return NextResponse.json(
      { error: 'Forbidden', message: `No permission to ${action} ${subjectType}` },
      { status: 403 },
    );
  }

  const module: Module = SUBJECT_TO_MODULE[subjectType] ?? (subjectType as Module);
  const mappedAction = ACTION_MAP[action];
  const actionsToCheck: Action[] = Array.isArray(mappedAction)
    ? mappedAction
    : [mappedAction ?? (action as Action)];

  let permitted = false;
  if (PREDEFINED_ROLES.has(role)) {
    permitted = actionsToCheck.some((a) => hasPermission(role as PredefinedRole, a, module));
  }

  if (!permitted) {
    return NextResponse.json(
      { error: 'Forbidden', message: `No permission to ${action} ${subjectType}` },
      { status: 403 },
    );
  }

  return null;
}
