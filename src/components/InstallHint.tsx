import { useT } from '../i18n/t';
import { Button, Illustration, Sheet } from './ui';

/** iOS keeps Home Screen apps' storage; Safari tabs lose it after 7 days idle. */
export function InstallHint({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Sheet onClose={onClose} labelledBy="install-title">
      {(close) => (<>
      <div class="sf-empty" style="padding:8px 0 0">
        <Illustration name="first-launch" width={200} height={150} />
        <h2 class="sf-h2" id="install-title">{t('install.title')}</h2>
        <p class="sf-meta">{t('install.body')}</p>
      </div>
      <Button block onClick={close}>{t('install.ok')}</Button>
      </>)}
    </Sheet>
  );
}
