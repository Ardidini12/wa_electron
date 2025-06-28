# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.
debug
window.electron.bulk.getSchedulerStatus()
Manual Trigger: If needed, you can force start with window.electron.bulk.forceStartProcessing()

npx @electron/packager . WhatsAppBulkSender --platform=win32 --arch=x64 --out=dist --overwrite --ignore="node_modules/((?!better-sqlite3|whatsapp-web.js).)*"

npx @electron/packager . WhatsAppBulkSender --platform=win32 --arch=x64 --out=dist --overwrite


Console Commands for Sales Monitoring:
window.electron.sales.getSalesSettings()
- Check current settings
window.electron.sales.getSalesMessageStatistics()
- Get message stats
window.electron.sales.getSalesScheduledMessages(1, 50, {}, {})
- Get scheduled messages
window.electron.sales.fetchSalesNow()
- Trigger manual fetch
window.electron.sales.getLastFetchTime()
- Check last fetch time
window.electron.sales.getSales(1, 10, {town: "all", search: "", startDate: null, endDate: null})
- Get sales list
Event Listeners (add to console):
window.electron.sales.onSalesFetched((data) => console.log("Sales fetched:", data))
window.electron.sales.onMessageSent((data) => console.log("Message sent:", data))
window.electron.sales.onMessageFailed((data) => console.log("Message failed:", data))
window.electron.sales.onMessagesScheduled((data) => console.log("Messages scheduled:", data))
Quick Test Commands:
console.log("Auto-scheduler enabled:", (await window.electron.sales.getSalesSettings()).settings?.autoScheduler)
console.log("Recent sales:", (await window.electron.sales.getSales(1, 5, {town: "all", search: "", startDate: null, endDate: null})).sales)

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  plugins: {
    // Add the react-x and react-dom plugins
    'react-x': reactX,
    'react-dom': reactDom,
  },
  rules: {
    // other rules...
    // Enable its recommended typescript rules
    ...reactX.configs['recommended-typescript'].rules,
    ...reactDom.configs.recommended.rules,
  },
})
```
