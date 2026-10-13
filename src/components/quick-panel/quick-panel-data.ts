import type {
  ProxyGroupView_Serialize,
  ProxyViewV1_Serialize,
} from '@/services/bindings'

import type { QuickGroup, QuickNode } from './quick-panel'

export type Favorites = Record<
  string,
  Pick<QuickNode, 'id' | 'name' | 'region'>[]
>
export const FAVORITES_KEY = 'clash-verge-quick-panel:v1'
export const favoriteScope = (profile: string, group: string) =>
  JSON.stringify([profile, group])

export function buildQuickGroups(
  view: ProxyViewV1_Serialize,
  profile: string,
  favorites: Favorites,
): QuickGroup[] {
  const groups = view.global
    ? [
        ...view.groups.filter((group) => group.name !== view.global?.name),
        view.global,
      ]
    : view.groups
  return groups
    .filter((group) => !group.hidden && group.type === 'Selector')
    .map((group: ProxyGroupView_Serialize) => {
      const nodes: QuickNode[] = group.members.map((member) => {
        const record =
          member.kind === 'node' ? view.records[member.recordId] : undefined
        const targetGroup =
          member.kind === 'group'
            ? groups.find((item) => item.name === member.name)
            : undefined
        const history = record?.history ?? targetGroup?.history ?? []
        const delay = history.at(-1)?.delay
        return {
          id: JSON.stringify([
            member.kind,
            member.name,
            record?.source ?? null,
          ]),
          name: member.name,
          region: '',
          delay: delay ?? null,
          testable: ![
            'DIRECT',
            'REJECT',
            'REJECT-DROP',
            'PASS',
            'COMPATIBLE',
          ].includes(member.name),
          available:
            member.kind !== 'unresolved' &&
            (member.kind !== 'node' || !!record),
        }
      })
      const saved = favorites[favoriteScope(profile, group.name)]
      const preferred = saved ?? []
      for (const favorite of preferred) {
        if (!nodes.some((node) => node.id === favorite.id))
          nodes.push({ ...favorite, delay: null, available: false })
      }
      return {
        id: group.name,
        name: group.name,
        nodes,
        selected:
          nodes.find((node) => node.name === group.now && node.available)?.id ??
          '',
        favorites: preferred.map((node) => node.id),
      }
    })
}
