import path from 'path';
import { app } from 'electron';
import { isDev } from './util.js';


export function getPreloadPath() {
    if (isDev()) {
        return path.join(app.getAppPath(), 'dist-electron/preload.cjs');
    } else {
        return path.join(app.getAppPath(), 'dist-electron/preload.cjs');
    }
}