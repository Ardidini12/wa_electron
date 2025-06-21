import { nativeTheme } from 'electron';
import Store from 'electron-store';
import { EventEmitter } from 'events';

export type ThemeType = 'light' | 'dark' | 'system';

export class ThemeManager extends EventEmitter {
    private store: Store;

    constructor() {
        super();
        this.store = new Store();
        this.initializeTheme();
    }

    private initializeTheme() {
        const savedTheme = this.store.get('theme', 'system') as ThemeType;
        this.setTheme(savedTheme);
    }

    setTheme(theme: ThemeType) {
        this.store.set('theme', theme);
        
        switch (theme) {
            case 'light':
                nativeTheme.themeSource = 'light';
                break;
            case 'dark':
                nativeTheme.themeSource = 'dark';
                break;
            case 'system':
            default:
                nativeTheme.themeSource = 'system';
                break;
        }

        this.emit('theme-changed', theme);
    }

    getCurrentTheme(): { 
        selected: ThemeType; 
        effective: 'light' | 'dark';
        shouldUseDarkColors: boolean;
    } {
        const selected = this.store.get('theme', 'system') as ThemeType;
        const effective = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
        
        return {
            selected,
            effective,
            shouldUseDarkColors: nativeTheme.shouldUseDarkColors
        };
    }

    getAvailableThemes(): ThemeType[] {
        return ['light', 'dark', 'system'];
    }
} 