import type { Role } from '../game/types';
import { getRoleName } from '../game/logic';

const GLYPHS: Record<Role, string> = {
  'greater-dalmuti': '👑',
  'lesser-dalmuti': '👑',
  merchant: '💰',
  'lesser-peon': '🧹',
  'greater-peon': '💩',
};

const SIZES: Record<Role, string> = {
  'greater-dalmuti': '1.5em',
  'lesser-dalmuti': '0.92em',
  merchant: '1.1em',
  'lesser-peon': '1.1em',
  'greater-peon': '1.1em',
};

/** Rank insignia: big crown, small crown, coin purse, broom, turd. */
export function RoleBadge({ role, className }: { role?: Role; className?: string }) {
  if (!role) {
    return (
      <span className={className} style={{ fontSize: '1em', lineHeight: 1 }}>
        •
      </span>
    );
  }
  return (
    <span
      className={className}
      title={getRoleName(role)}
      aria-label={getRoleName(role)}
      style={{ fontSize: SIZES[role], lineHeight: 1, display: 'inline-block', verticalAlign: '-0.12em' }}
    >
      {GLYPHS[role]}
    </span>
  );
}
