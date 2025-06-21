import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

interface ThemeContextType {
  theme: 'light' | 'dark' | 'system';
  effectiveTheme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

interface ThemeProviderProps {
  children: ReactNode;
}

const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>('system');
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    initializeTheme();
    setupThemeListener();
  }, []);

  const initializeTheme = async () => {
    try {
      const themeData = await window.electron.theme.get();
      setThemeState(themeData.selected);
      setEffectiveTheme(themeData.effective);
      applyThemeToDOM(themeData.effective);
    } catch (error) {
      console.error('Failed to get theme:', error);
    }
  };

  const setupThemeListener = () => {
    window.electron.theme.onChange((themeData: any) => {
      setThemeState(themeData.selected);
      setEffectiveTheme(themeData.effective);
      applyThemeToDOM(themeData.effective);
    });
  };

  const setTheme = async (newTheme: 'light' | 'dark' | 'system') => {
    try {
      await window.electron.theme.set(newTheme);
      setThemeState(newTheme);
    } catch (error) {
      console.error('Failed to set theme:', error);
    }
  };

  const applyThemeToDOM = (theme: 'light' | 'dark') => {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.className = `theme-${theme}`;
  };

  return (
    <ThemeContext.Provider value={{ theme, effectiveTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export default ThemeProvider; 