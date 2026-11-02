import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import './styles/tokens.css';
import './styles/components.css';
import './styles/app.css';
import './styles/motion.css';
import './styles/food.css';
import { App } from './app';
import { unlockAudio } from './lib/sound';

registerSW({ immediate: true });
// iOS only starts audio inside a user gesture.
addEventListener('pointerdown', unlockAudio, { passive: true });
render(<App />, document.getElementById('app')!);
