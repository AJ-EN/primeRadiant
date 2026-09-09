import type { Derived } from './engine';

/**
 * The headline, as a plain string, so the share composer and the <h1> can never disagree.
 * This sentence is the shareable claim — it is what a stranger sees before they understand
 * anything else about the model.
 */
export function headline(d: Derived, months: number): string {
  switch (d.outcome) {
    case 'dies_before_arrival':
      return 'You die before you get there.';
    case 'never_runs_out':
      return 'You never run out.';
    case 'structural_runout':
      return `You run out in month ${d.runoutMonth}, and the model does not recover.`;
    case 'plateau_below_burn':
      return `You survive ${months} months, then plateau below burn.`;
  }
}

export function tone(d: Derived): 'good' | 'bad' {
  return d.outcome === 'never_runs_out' ? 'good' : 'bad';
}
