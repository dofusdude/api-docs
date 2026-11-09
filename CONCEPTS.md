## Game data concepts

Classes, spells, monsters and world areas are independently addressable resources.
Their relationships let clients combine them when needed. A client can use one
resource without loading the others. The following conventions apply whether
you are building a calculator, search tool, game integration or data browser.

### IDs, names and snapshots

Use `ankama_id` as identity within a resource, not the translated name or an
array position. The same number in two different resources does not establish
a relationship. A spell's `icon_id` and a monster's `gfx_id` identify assets,
not API records. Use supplied `image_urls` rather than constructing filenames.
An image field can be absent when no image is available.

The language in the request selects localized text. Missing translations fall
back to English for mapped game data. IDs do not change when the language changes.
The version endpoint identifies the game-data snapshot. Game updates can change
names, statistics and assignments, so refresh related cached records together
when the snapshot changes.

The software-beta host previews API changes. This is separate from the Dofus
game-beta dataset. Use only the game values offered by the selected API server.

### Grades are variants, not IDs or character levels

| Field | Meaning | How to use it |
| --- | --- | --- |
| `Monster.grades[].grade` | A numbered variant of this monster | Select its statistics and assigned spells |
| `Monster.grades[].level` | The combat level of that monster variant | Display or filter by monster level |
| `Spell.levels[].grade` | A numbered variant of this spell | Select its costs, effects and casting limits |
| `Spell.levels[].ankama_id` | The game record ID for that spell-level definition | Match explicit spell-level references such as script bindings |
| `Spell.levels[].min_player_level` | The player-level requirement recorded for that spell grade | Keep separate from the grade number |
| `MonsterSpellRelationship.grade` | The spell grade assigned to the enclosing monster grade | Follow its URL or request that exact spell grade |

The `levels` name on spells is historical. Its entries are spell grades, not
a list of player levels. A class does not have monster grades. Its `spells`
contain spell definitions with their own `levels` arrays.

Playable classes are also called breeds in the client game data. Use the
`classes` resource for them. Monster families and their broader groupings are
a separate taxonomy.

Grade numbers belong to their containing monster or spell. Monster grade 5
does not imply spell grade 5. Select records by their explicit `grade` values,
not by array offsets, and do not assume a fixed number of grades. A spell's
top-level `ankama_id` stays the same across its grades.

### Following and expanding relationships

Single-record endpoints return full records. A class response includes full
spell definitions in `spells`. Those spells can also be requested independently
from the spells endpoint.

Monster spells are grouped under the monster grade that uses them. By default,
each assignment is a compact object with `ankama_id`, `name`, `grade` and `url`.
The URL already selects the assigned spell grade. Follow it without removing
the query string if you want exactly the assigned variant.

For example, these requests offer different response sizes:

```http
GET /dofus3/v1/en/monsters/31
GET /dofus3/v1/en/monsters/31?include=spells.grade
GET /dofus3/v1/en/monsters/31?include=spells
GET /dofus3/v1/en/spells/10198?grade=1
```

The first returns spell assignments as links. `spells.grade` embeds each
assigned spell with only its assigned entry in `levels`. `spells` embeds the
complete definition with all available spell grades. Asking a spell endpoint
for `grade=1` returns a spell object whose `levels` contains that grade, not a
bare spell-level object. An unavailable grade returns 404.

Small references containing an ID and name are not complete records. Interpret
them according to the field containing them. For example, `race.super_race`
describes monster taxonomy, not a playable class. `race` is the monster family,
and `race.super_race` is its broader grouping. Spell `classes` and `monsters`
are reverse associations, not substitutes for grade-specific assignments.

### Effects, targeting and areas of effect

Read a spell grade's `effects` for its normal outcome and `critical_effects`
for its critical outcome. Keep them separate instead of adding both lists
together as if every cast applies both. Effect `templated` text is localized
display text. Numeric fields and structured targeting describe the data behind it.

Each effect has its own `zone`. There is no single damage zone that safely
describes every effect of a spell. A weapon's `combat.zone` describes weapon
combat geometry. Spell preview zones and script activation/display zones serve
different purposes and must not replace effect zones.

Use `zone.shape.name` with `size`, `min_size` and the other zone properties.
Sizes describe combat-cell geometry, not world-map distances. Point zones have
size 0. Whole-map and explicit-cell shapes do not need the same size fields as
circles. An empty `cell_ids` list does not mean an empty zone when the shape is
geometric. Exact affected cells can also depend on cast direction, target
position, line of sight and the current fight state.

`target_mask` answers who can be affected. Its selectors identify categories
such as allies or enemies, and its conditions restrict them according to the
reported `logic`. `triggers` answers when an effect activates, such as immediately
or after an event. Use resolved names, descriptions and structured references.
Original `raw` strings and token `code` values are diagnostic data, not text
that users need to decode.

AP means action points and MP means movement points. Spell ranges are in combat
cells. Duration and casting-delay fields concern fight turns, not real-time
seconds. Preserve zero values rather than treating them as missing. Limits and
special source values must be interpreted per field, not through a universal
rule that every zero means unlimited. These definitions are game data, not a
complete damage calculator or fight simulator.

### World areas, spawn locations and drops

The world hierarchy is **super-area → area → subarea → map**. These geographic
areas are unrelated to an effect's combat-cell zone. A map ID identifies a
specific game map. Coordinates should be interpreted with `world_map_id`, not
as a globally unique location by themselves.

`spawn_locations` lists the monster's known spawn subareas and their parent
areas. `subarea_maps` lists maps belonging to each subarea. It does not guarantee
that the monster spawns on every listed map or is currently present there.
`preferred` marks a preferred subarea in the source data. It is not a spawn
probability. The API does not provide a per-map spawn percentage or live population.

Drop percentages are different. Match `drops[].rates_percent[].grade` to the
selected **monster grade**, not a spell grade. A percentage of 5 means 5%, not
0.05%. These are base drop rates, not a player's final chance after conditions,
modifiers and fight-specific rules. `global_drops` exposes a percentage range
instead of the same grade-rate table. Do not invent a grade-specific rate from it.

### Conditions and incomplete client knowledge

Conditions are trees. A node with `is_operand: true` contains one requirement
in `condition`. A relation node combines `children` using `and` or `or`.
Keep this grouping when displaying or evaluating a requirement. Use interpreted
`kind`, `operator`, values, units and references rather than translating raw codes.

Only client-side conditions available in the game data are represented.
Server-owned predicates are excluded during mapping. A missing condition does
not prove that the server imposes no restriction. Likewise, `has_conditions`
can remain true without a complete evaluable condition tree. Do not present a
client-side check as an authoritative server eligibility decision.

### Choosing response size and query transport

The classes, spells, monsters and world-area lists return compact summaries by
default. Use their single-record endpoints for full details, or request
`fields[spells]=all` on the spells collection, with the corresponding resource
name for other collections. These names differ from older item fields such as
`fields[item]`. Follow each operation's schema. `include` expands a relationship
and is not the same as requesting full fields.

GET uses URL parameters. QUERY is a read-only alternative with structured JSON,
not a mutation or saved query. For example, `fields[spells]=all` corresponds to
`{"fields":{"spells":["all"]}}` in a QUERY body. Related properties are nested
objects, not JSON keys containing dots. `/search` is relevance-based text search.
Collection filters select matching records and do not remove non-matching
grades from a record. Use the spell detail endpoint's `grade` parameter to select
one spell grade explicitly.

Follow `_links` for pagination. For QUERY, repeat the same method and body when
following a pagination URL. Do not turn that URL into a GET request. Bulk `/all`
responses can be large. Prefer pagination for interactive or incremental use.
An empty array means no entries were returned in that field. An omitted field
can instead reflect a summary response, an unavailable optional value or a
field that does not apply. None of those alone proves a resource has no related data.
