import AutoLaunch from 'auto-launch';
import { app } from 'electron';
import { EventEmitter } from 'events';

export class AutoLaunchManager extends EventEmitter {
    private autoLauncher: AutoLaunch;

    constructor() {
        super();
        this.autoLauncher = new AutoLaunch({
            name: 'WhatsApp Bulk Sender',
            path: app.getPath('exe'),
            isHidden: false, // Start minimized to tray
        });
    }

    async setAutoLaunch(enabled: boolean): Promise<boolean> {
        try {
            const isEnabled = await this.autoLauncher.isEnabled();
            
            if (enabled && !isEnabled) {
                await this.autoLauncher.enable();
                this.emit('auto-launch-enabled');
                console.log('Auto-launch enabled');
            } else if (!enabled && isEnabled) {
                await this.autoLauncher.disable();
                this.emit('auto-launch-disabled');
                console.log('Auto-launch disabled');
            }
            
            return true;
        } catch (error) {
            console.error('Failed to set auto-launch:', error);
            this.emit('auto-launch-error', error);
            return false;
        }
    }

    async isAutoLaunchEnabled(): Promise<boolean> {
        try {
            return await this.autoLauncher.isEnabled();
        } catch (error) {
            console.error('Failed to check auto-launch status:', error);
            return false;
        }
    }

    async toggleAutoLaunch(): Promise<boolean> {
        try {
            const isEnabled = await this.isAutoLaunchEnabled();
            return await this.setAutoLaunch(!isEnabled);
        } catch (error) {
            console.error('Failed to toggle auto-launch:', error);
            return false;
        }
    }
} 