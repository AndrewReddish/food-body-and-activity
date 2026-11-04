import { useState } from 'preact/hooks';
import type { Dish, DishKind, DishPart, Method, Plan } from '../model/types';
import { DISH_KINDS, METHODS } from '../model/schema';
import { BUILTIN_DISHES } from '../model/dishes';
import { useLang, useT } from '../i18n/t';
import { sound } from '../lib/sound';
import { Button, Chip, Icon, IconButton, Sheet, TextField, Toggle } from './ui';
import { GroupChip, groupLabel, itemName, newId } from './food';
import { dishName } from './dishes';

/** Settings → dishes used for ideas: hide built-in ones, add and edit your own. */
export function DishesSheet({ plan, save, onClose }: { plan: Plan; save: (p: Plan) => Promise<void>; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const [editing, setEditing] = useState<Dish | null>(null);
  const hidden = new Set(plan.hiddenDishes ?? []);
  const mine = plan.dishes ?? [];

  const toggle = (id: string, on: boolean) => {
    const next = new Set(hidden);
    if (on) next.delete(id); else next.add(id);
    void save({ ...plan, hiddenDishes: [...next] });
  };
  const upsert = (d: Dish) => void save({ ...plan, dishes: mine.some((x) => x.id === d.id) ? mine.map((x) => (x.id === d.id ? d : x)) : [...mine, d] });
  const remove = (id: string) => void save({ ...plan, dishes: mine.filter((x) => x.id !== id) });

  if (editing) return <DishEditor dish={editing} plan={plan} onSave={(d) => { upsert(d); setEditing(null); }} onDelete={mine.some((x) => x.id === editing.id) ? () => { remove(editing.id); setEditing(null); } : undefined} onClose={() => setEditing(null)} />;

  return (
    <Sheet onClose={onClose} labelledBy="dishes-title">
      {(close) => (<>
        <div class="sf-sheet__head">
          <h2 class="sf-h2" id="dishes-title" style="flex:1">{t('dishes.title')}</h2>
          <IconButton icon="close" label={t('common.close')} tone="sunk" size={22} onClick={close} />
        </div>
        <p class="sf-meta">{t('dishes.hint')}</p>

        <h3 class="sf-section">{t('dishes.mine')}</h3>
        <div class="sf-list">
          {mine.map((d) => (
            <button type="button" class="sf-row sf-row--tall" onClick={() => setEditing(d)}>
              <span class="sf-row__main">
                <span class="sf-row__title">{dishName(d, lang)}</span>
                <span class="sf-row__sub">{t('dish.kind.' + d.kind)} · {d.parts.map((p) => plan.groups.find((g) => g.id === p.group)?.letter).join(' ')}</span>
              </span>
              <Icon name="pen" size={20} />
            </button>
          ))}
          <button type="button" class="sf-row" onClick={() => setEditing({ id: `dish-${newId()}`.slice(0, 40), nameUk: '', nameEn: '', kind: 'main', parts: [] })}>
            <Icon name="plus" size={22} /><span class="sf-row__title sf-row__title--accent" style="flex:1">{t('dishes.add')}</span>
          </button>
        </div>

        <h3 class="sf-section">{t('dishes.builtin')}</h3>
        <div class="sf-list">
          {BUILTIN_DISHES.map((d) => (
            <div class="sf-row">
              <span class="sf-row__main">
                <span class="sf-row__title" style={hidden.has(d.id) ? 'color:var(--ink-3)' : ''}>{dishName(d, lang)}</span>
                <span class="sf-row__sub">{t('dish.kind.' + d.kind)}</span>
              </span>
              <Toggle checked={!hidden.has(d.id)} label={`${t('plan.active')}: ${dishName(d, lang)}`} onChange={(on) => toggle(d.id, on)} />
            </div>
          ))}
        </div>
        <Button block onClick={close}>{t('common.done')}</Button>
      </>)}
    </Sheet>
  );
}

function DishEditor({ dish, plan, onSave, onDelete, onClose }: {
  dish: Dish; plan: Plan; onSave: (d: Dish) => void; onDelete?: () => void; onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const [name, setName] = useState(dish.nameUk);
  const [kind, setKind] = useState<DishKind>(dish.kind);
  const [parts, setParts] = useState<DishPart[]>(dish.parts);
  const groups = [...plan.groups].sort((a, b) => a.order - b.order);
  const partOf = (g: string) => parts.find((p) => p.group === g);

  const toggleItem = (g: string, id: string) => {
    const p = partOf(g);
    if (!p) return setParts([...parts, { group: g, items: [id] }]);
    const items = p.items.includes(id) ? p.items.filter((x) => x !== id) : [...p.items, id];
    setParts(items.length ? parts.map((x) => (x.group === g ? { ...x, items } : x)) : parts.filter((x) => x.group !== g));
  };
  const setMethod = (g: string, m: string) =>
    setParts(parts.map((x) => (x.group === g ? (m ? { ...x, method: m as Method } : { group: x.group, items: x.items, ...(x.weight ? { weight: x.weight } : {}) }) : x)));
  const valid = name.trim().length > 0 && parts.length > 0;

  return (
    <Sheet onClose={onClose} labelledBy="dish-edit-title">
      {(close) => (<>
        <div class="sf-sheet__head">
          <h2 class="sf-h2" id="dish-edit-title" style="flex:1">{dish.nameUk ? t('dishes.edit') : t('dishes.add')}</h2>
          <IconButton icon="close" label={t('common.close')} tone="sunk" size={22} onClick={close} />
        </div>
        <TextField id="dish-name" ui label={t('dishes.name')} placeholder={t('dishes.namePlaceholder')} value={name} maxLength={80} onInput={setName} />
        <label class="sf-field"><span class="sf-field__label">{t('dishes.kind')}</span>
          <select class="sf-input sf-input--ui" value={kind} onChange={(e) => setKind((e.currentTarget as HTMLSelectElement).value as DishKind)}>
            {DISH_KINDS.map((k) => <option value={k}>{t('dish.kind.' + k)}</option>)}
          </select>
        </label>
        <p class="sf-meta">{t('dishes.partsHint')}</p>
        {groups.map((g) => {
          const p = partOf(g.id);
          const items = plan.items.filter((i) => i.group === g.id && i.active).sort((a, b) => a.order - b.order);
          return (
            <div class="dish-group">
              <div class="dish-group__head">
                <GroupChip group={g} size={30} />
                <span class="sf-row__title" style="flex:1">{groupLabel(g, lang)}</span>
                {p && (
                  <select class="sf-input sf-input--ui dish-group__method" value={p.method ?? ''} aria-label={t('log.method')} onChange={(e) => setMethod(g.id, (e.currentTarget as HTMLSelectElement).value)}>
                    <option value="">{t('dishes.anyMethod')}</option>
                    {METHODS.map((m) => <option value={m}>{t('method.' + m)}</option>)}
                  </select>
                )}
              </div>
              <div class="sf-chips">
                {items.map((i) => (
                  <Chip palette={g.palette} selected={!!p?.items.includes(i.id)} onClick={() => toggleItem(g.id, i.id)}>
                    {p?.items.includes(i.id) && p.items.length > 1 ? `${p.items.indexOf(i.id) + 1}. ` : ''}{itemName(i, lang)}
                  </Chip>
                ))}
              </div>
            </div>
          );
        })}
        <div class="sf-sheet__actions">
          <Button block icon="check" disabled={!valid} onClick={() => { sound('saved'); onSave({ ...dish, nameUk: name.trim(), nameEn: name.trim(), kind, parts }); }}>{t('common.save')}</Button>
          {onDelete && <Button variant="ghost" icon="trash" onClick={() => { sound('clear'); onDelete(); }}>{t('dishes.delete')}</Button>}
        </div>
      </>)}
    </Sheet>
  );
}
