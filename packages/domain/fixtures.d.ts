import type { State, PersonPrincipal, EndpointPrincipal } from './index.js';
export type FixtureKind = 'local_coding' | 'hosted_coding' | 'custom_turn_based' | 'custom_durable';
export type Fixture = { seed: State; person: PersonPrincipal; other_person: PersonPrincipal; agent: EndpointPrincipal; desktop: PersonPrincipal; mobile: PersonPrincipal; connection_id: string; endpoint_id: string; conversation_id: string };
export function createFixture(kind: FixtureKind, options?: { online?: boolean }): Fixture;
