// Mobile Optimizer Pro v2.0 - Complete Extension
// Features: Auto-detect, Per-Chat, Theme Support, Export/Import, Lazy Load Profile

(function () {
  'use strict';

  const EXT_ID = 'mobile_optimizer_pro';
  const STORAGE_KEY = 'ext_settings.mobile_optimizer_pro';
  const CHAT_OVERRIDES_KEY = 'ext_settings.mobile_optimizer_pro_chat_overrides';
  const EXT_DISPLAY = 'Mobile Optimizer Pro';

  // Default Settings
  const DEFAULTS = {
    enabled: true,
    autoDetect: true,
    virtualize: true,
    threshold: 12,
    lockViewport: true,
    stripAnimations: true,
    hideAvatars: false,
    lazyLoad: true,
    lazyProfile: true,
    aggressiveCss: true,
    themeDetect: true,
    perChat: false,
    debug: false,
    optimizedExtensions: []
  };

  let settings = { ...DEFAULTS };
  let chatOverrides = {};
  let archivedNodes = new Map();
  let extensionList = [];
  let statsInterval = null;
  let currentChatId = null;
  let devicePerformance = 'medium';

  // ─── Settings Management ─────────────────────────────────────────────────────
  function loadSettings() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      settings = { ...DEFAULTS, ...(saved ? JSON.parse(saved) : {}) };
      
      const savedOverrides = localStorage.getItem(CHAT_OVERRIDES_KEY);
      chatOverrides = savedOverrides ? JSON.parse(savedOverrides) : {};
    } catch (e) {
      console.error(`[${EXT_DISPLAY}] Failed to load settings:`, e);
      settings = { ...DEFAULTS };
      chatOverrides = {};
    }  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      localStorage.setItem(CHAT_OVERRIDES_KEY, JSON.stringify(chatOverrides));
    } catch (e) {
      console.error(`[${EXT_DISPLAY}] Failed to save settings:`, e);
    }
  }

  // ─── Device Performance Detection ────────────────────────────────────────────
  function detectDevicePerformance() {
    if (!settings.autoDetect) return;

    const startTime = performance.now();
    
    // Simple benchmark: create and remove DOM elements
    const testDiv = document.createElement('div');
    testDiv.style.display = 'none';
    document.body.appendChild(testDiv);
    
    for (let i = 0; i < 100; i++) {
      const child = document.createElement('div');
      child.textContent = 'test';
      testDiv.appendChild(child);
    }
    
    testDiv.innerHTML = '';
    document.body.removeChild(testDiv);
    
    const endTime = performance.now();
    const duration = endTime - startTime;

    if (duration < 10) {
      devicePerformance = 'high';
      settings.threshold = Math.max(settings.threshold, 20);
    } else if (duration < 30) {
      devicePerformance = 'medium';
      settings.threshold = Math.max(settings.threshold, 12);
    } else {
      devicePerformance = 'low';
      settings.threshold = Math.max(settings.threshold, 8);
    }

    if (settings.debug) {
      console.log(`[${EXT_DISPLAY}] Device performance: ${devicePerformance} (${duration.toFixed(2)}ms)`);
    }

    updatePerformanceDisplay();  }

  function updatePerformanceDisplay() {
    const perfEl = document.getElementById('mop-device-perf');
    if (perfEl) {
      perfEl.textContent = devicePerformance.charAt(0).toUpperCase() + devicePerformance.slice(1);
      perfEl.style.color = devicePerformance === 'high' ? '#4ade80' : 
                           devicePerformance === 'medium' ? '#fbbf24' : '#ef4444';
    }
  }

  // ─── Theme Detection ─────────────────────────────────────────────────────────
  function detectCurrentTheme() {
    if (!settings.themeDetect) return;

    const themeEl = document.getElementById('mop-current-theme');
    if (!themeEl) return;

    // Check for common theme indicators
    const bodyClasses = document.body.className;
    const htmlClasses = document.documentElement.className;
    
    let themeName = 'Default';
    
    if (bodyClasses.includes('dark') || htmlClasses.includes('dark')) {
      themeName = 'Dark Theme';
    } else if (bodyClasses.includes('light') || htmlClasses.includes('light')) {
      themeName = 'Light Theme';
    } else if (bodyClasses.includes('amoled') || htmlClasses.includes('amoled')) {
      themeName = 'AMOLED Theme';
    }

    // Check for custom theme files
    const themeLinks = document.querySelectorAll('link[rel="stylesheet"]');
    themeLinks.forEach(link => {
      if (link.href.includes('theme')) {
        const match = link.href.match(/theme[_-]?([a-z0-9]+)/i);
        if (match) {
          themeName = match[1].charAt(0).toUpperCase() + match[1].slice(1) + ' Theme';
        }
      }
    });

    themeEl.textContent = themeName;

    if (settings.debug) {
      console.log(`[${EXT_DISPLAY}] Detected theme: ${themeName}`);
    }
  }
  // ─── Per-Chat Settings ───────────────────────────────────────────────────────
  function getCurrentChatId() {
    // Try to get current chat ID from SillyTavern context
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
      const ctx = SillyTavern.getContext();
      return ctx.chatId || null;
    }
    
    // Fallback: check URL or DOM
    const chatElement = document.querySelector('[data-chat-id]');
    if (chatElement) {
      return chatElement.dataset.chatId;
    }
    
    return null;
  }

  function applyChatOverride() {
    if (!settings.perChat || !currentChatId) return;

    const override = chatOverrides[currentChatId];
    if (override) {
      settings.threshold = override.threshold || DEFAULTS.threshold;
      settings.virtualize = override.virtualize !== undefined ? override.virtualize : DEFAULTS.virtualize;
      
      if (settings.debug) {
        console.log(`[${EXT_DISPLAY}] Applied chat override for ${currentChatId}:`, override);
      }
    }
  }

  function saveChatOverride() {
    if (!currentChatId) return;

    chatOverrides[currentChatId] = {
      threshold: settings.threshold,
      virtualize: settings.virtualize,
      hideAvatars: settings.hideAvatars
    };

    saveSettings();

    if (typeof toastr !== 'undefined') {
      toastr.success('Chat override saved!', EXT_DISPLAY);
    }
  }

  // ─── Extension Detection ─────────────────────────────────────────────────────
  function detectExtensions() {
    extensionList = [];    
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
      const ctx = SillyTavern.getContext();
      if (ctx.extensionSettings) {
        Object.keys(ctx.extensionSettings).forEach(extName => {
          if (extName !== EXT_ID) {
            extensionList.push({
              name: extName,
              displayName: extName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
              enabled: true
            });
          }
        });
      }
    }

    const extContainers = document.querySelectorAll('[id*="extension"], [class*="extension"]');
    extContainers.forEach(container => {
      const id = container.id || '';
      const className = container.className || '';
      const match = id.match(/ext[_-]?([a-z0-9_]+)/i) || className.match(/ext[_-]?([a-z0-9_]+)/i);
      
      if (match && match[1]) {
        const extName = match[1].toLowerCase();
        if (!extensionList.find(e => e.name === extName)) {
          extensionList.push({
            name: extName,
            displayName: extName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            enabled: true
          });
        }
      }
    });

    extensionList.sort((a, b) => a.name.localeCompare(b.name));

    if (settings.debug) {
      console.log(`[${EXT_DISPLAY}] Detected extensions:`, extensionList);
    }

    return extensionList;
  }

  // ─── CSS Injection ───────────────────────────────────────────────────────────
  function injectCSS() {
    let styleEl = document.getElementById('mop-optimized-css');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'mop-optimized-css';
      document.head.appendChild(styleEl);    }

    let css = `
      /* Core Performance */
      #chat {
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        contain: strict;
        transform: translate3d(0,0,0);
      }

      /* Viewport Lock */
      body.mop-viewport-locked #chat {
        height: 100dvh !important;
        position: fixed !important;
        inset: 0 !important;
      }

      /* Lazy Load Profile Images */
      .mop-lazy-profile img {
        opacity: 0;
        transition: opacity 0.3s;
      }

      .mop-lazy-profile img.loaded {
        opacity: 1;
      }
    `;

    // Aggressive CSS Stripping
    if (settings.aggressiveCss && settings.optimizedExtensions.length > 0) {
      const extSelectors = settings.optimizedExtensions.map(ext => {
        return `[id*="${ext}"], [class*="${ext}"]`;
      }).join(', ');

      if (extSelectors) {
        css += `
          ${extSelectors} {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            filter: none !important;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1) !important;
            background-attachment: scroll !important;
          }
        `;
      }
    }

    if (settings.stripAnimations) {
      css += `        .mop-no-anim * {
          animation: none !important;
          transition: none !important;
        }
      `;
    }

    if (settings.hideAvatars) {
      css += `
        .mop-hide-avatars .avatar,
        .mop-hide-avatars .mes_avatar {
          display: none !important;
        }
      `;
    }

    css += `
      .mes.mop-archived {
        height: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
        overflow: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        contain: strict !important;
      }
    `;

    styleEl.textContent = css;
  }

  // ─── Viewport Lock ───────────────────────────────────────────────────────────
  function setupViewportLock() {
  if (!settings.lockViewport) {
    document.body.classList.remove('mop-viewport-locked');
    document.body.style.height = '';
    document.body.style.overflow = '';
    return;
  }

  const visualViewport = window.visualViewport;
  
  if (!visualViewport) {
    // Fallback สำหรับเบราว์เซอร์เก่า
    document.body.classList.add('mop-keyboard-fix');
    return;
  }

  let lastHeight = visualViewport.height;
  let keyboardOpen = false;

  const handleResize = () => {
    const currentHeight = visualViewport.height;
    const windowHeight = window.innerHeight;
    const viewportHeight = visualViewport.height;
    
    // ตรวจจับว่าแป้นพิมพ์เปิดหรือไม่
    const isKeyboardOpen = viewportHeight < windowHeight * 0.75;
    
    if (isKeyboardOpen !== keyboardOpen) {
      keyboardOpen = isKeyboardOpen;
      
      if (keyboardOpen) {
        // แป้นพิมพ์เปิด
        document.body.classList.add('mop-viewport-locked');
        document.body.style.height = `${viewportHeight}px`;
        document.body.style.overflow = 'hidden';
        
        // เลื่อนลงล่างสุด
        setTimeout(() => {
          const chat = document.getElementById('chat');
          if (chat) {
            chat.scrollTop = chat.scrollHeight;
          }
          window.scrollTo(0, 0);
        }, 100);
      } else {
        // แป้นพิมพ์ปิด
        document.body.classList.remove('mop-viewport-locked');
        document.body.style.height = '';
        document.body.style.overflow = '';
      }
    }
    
    lastHeight = currentHeight;
  };

  // ลบ event listener เก่า
  if (window.mopViewportHandler) {
    visualViewport.removeEventListener('resize', window.mopViewportHandler);
  }
  
  // เพิ่ม event listener ใหม่
  visualViewport.addEventListener('resize', handleResize);
  visualViewport.addEventListener('scroll', handleResize);
  window.mopViewportHandler = handleResize;
  
  // เรียกครั้งแรก
  handleResize();
}

  // ─── DOM Virtualization ──────────────────────────────────────────────────────
  function virtualizeChat() {
    if (!settings.virtualize) return;

    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;
    const messages = Array.from(chatContainer.querySelectorAll('.mes'));
    const total = messages.length;
    const keep = settings.threshold;

    if (total <= keep) {
      restoreAllArchived();
      return;
    }

    for (let i = 0; i < total - keep; i++) {
      const msg = messages[i];
      if (!msg || msg.classList.contains('mop-archived')) continue;

      if (!archivedNodes.has(msg)) {
        archivedNodes.set(msg, {
          html: msg.innerHTML,
          dataset: { ...msg.dataset },
          attributes: {}
        });

        for (const attr of msg.attributes) {
          if (!['class', 'style', 'data-archived'].includes(attr.name)) {
            archivedNodes.get(msg).attributes[attr.name] = attr.value;
          }
        }
      }

      msg.classList.add('mop-archived');
      msg.dataset.archived = 'true';
      msg.innerHTML = '';
    }

    updateStats();
  }

  function restoreAllArchived() {
    archivedNodes.forEach((data, node) => {
      if (node.classList.contains('mop-archived')) {
        node.classList.remove('mop-archived');
        node.innerHTML = data.html;
        node.removeAttribute('data-archived');
        for (const [key, val] of Object.entries(data.attributes)) {
          node.setAttribute(key, val);
        }
      }
    });
    archivedNodes.clear();
    updateStats();
  }
  // ─── Lazy Loading ────────────────────────────────────────────────────────────
  function enforceLazyLoad() {
    if (!settings.lazyLoad) return;

    const images = document.querySelectorAll('#chat img');
    images.forEach(img => {
      if (!img.hasAttribute('loading')) {
        img.setAttribute('loading', 'lazy');
      }
    });
  }

  function enforceLazyLoadProfile() {
    if (!settings.lazyProfile) return;

    // Target profile/avatar images
    const profileImages = document.querySelectorAll('.avatar img, .mes_avatar img, [class*="profile"] img');
    
    profileImages.forEach(img => {
      if (!img.classList.contains('mop-lazy-loaded')) {
        img.classList.add('mop-lazy-loaded');
        
        // Use IntersectionObserver for true lazy loading
        if ('IntersectionObserver' in window) {
          const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
              if (entry.isIntersecting) {
                const img = entry.target;
                if (img.dataset.src) {
                  img.src = img.dataset.src;
                  img.classList.add('loaded');
                }
                observer.unobserve(img);
              }
            });
          }, { rootMargin: '50px' });

          observer.observe(img);
        } else {
          // Fallback for older browsers
          img.setAttribute('loading', 'lazy');
        }
      }
    });
  }

  // ─── Stats Update ────────────────────────────────────────────────────────────
  function updateStats() {
    const domCount = document.querySelectorAll('*').length;
    const archivedCount = archivedNodes.size;    const memorySaved = (archivedCount * 0.5).toFixed(1);

    const domEl = document.getElementById('mop-dom-count');
    const archivedEl = document.getElementById('mop-archived-count');
    const memoryEl = document.getElementById('mop-memory-saved');

    if (domEl) domEl.textContent = domCount.toLocaleString();
    if (archivedEl) archivedEl.textContent = archivedCount;
    if (memoryEl) memoryEl.textContent = `${memorySaved} MB`;
  }

  // ─── Export/Import ───────────────────────────────────────────────────────────
  function exportSettings() {
    const exportData = {
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      settings: settings,
      chatOverrides: chatOverrides
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mobile-optimizer-pro-settings-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (typeof toastr !== 'undefined') {
      toastr.success('Settings exported successfully!', EXT_DISPLAY);
    }
  }

  function importSettings(file) {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        
        if (data.settings) {
          settings = { ...DEFAULTS, ...data.settings };
        }
        
        if (data.chatOverrides) {
          chatOverrides = data.chatOverrides;
        }
                saveSettings();
        applyAll();
        
        if (typeof toastr !== 'undefined') {
          toastr.success('Settings imported successfully!', EXT_DISPLAY);
        }
        
        location.reload();
      } catch (err) {
        console.error(`[${EXT_DISPLAY}] Import failed:`, err);
        if (typeof toastr !== 'undefined') {
          toastr.error('Failed to import settings. Invalid file format.', EXT_DISPLAY);
        }
      }
    };
    
    reader.readAsText(file);
  }

  // ─── Settings UI ─────────────────────────────────────────────────────────────
  function initSettingsUI() {
    const checkInterval = setInterval(() => {
      const settingsPanel = document.getElementById('mobile_optimizer_pro_settings');
      if (settingsPanel) {
        clearInterval(checkInterval);
        setupSettingsPanel(settingsPanel);
      }
    }, 100);

    setTimeout(() => clearInterval(checkInterval), 5000);
  }

  function setupSettingsPanel(panel) {
    // Load current settings into UI
    const fields = {
      enabled: '#mop-enabled',
      autoDetect: '#mop-auto-detect',
      virtualize: '#mop-virtualize',
      threshold: '#mop-threshold',
      lockViewport: '#mop-lock-viewport',
      stripAnimations: '#mop-strip-animations',
      hideAvatars: '#mop-hide-avatars',
      lazyLoad: '#mop-lazy-load',
      lazyProfile: '#mop-lazy-profile',
      aggressiveCss: '#mop-aggressive-css',
      themeDetect: '#mop-theme-detect',
      perChat: '#mop-per-chat',
      debug: '#mop-debug'
    };
    Object.entries(fields).forEach(([key, selector]) => {
      const el = panel.querySelector(selector);
      if (el) {
        if (el.type === 'checkbox') {
          el.checked = settings[key];
        } else if (el.type === 'range') {
          el.value = settings[key];
          const valueEl = panel.querySelector(`${selector}-value`);
          if (valueEl) valueEl.textContent = settings[key];
        }
      }
    });

    // Event listeners
    const threshold = panel.querySelector('#mop-threshold');
    const thresholdValue = panel.querySelector('#mop-threshold-value');
    if (threshold && thresholdValue) {
      threshold.addEventListener('input', () => {
        thresholdValue.textContent = threshold.value;
      });
    }

    // Per-chat settings
    const perChatCheckbox = panel.querySelector('#mop-per-chat');
    const chatOverridesDiv = panel.querySelector('#mop-chat-overrides');
    if (perChatCheckbox && chatOverridesDiv) {
      perChatCheckbox.addEventListener('change', () => {
        chatOverridesDiv.style.display = perChatCheckbox.checked ? 'block' : 'none';
      });
      
      if (settings.perChat) {
        chatOverridesDiv.style.display = 'block';
      }
    }

    // Update current chat info
    currentChatId = getCurrentChatId();
    const currentChatNameEl = panel.querySelector('#mop-current-chat-name');
    if (currentChatNameEl) {
      currentChatNameEl.textContent = currentChatId || 'Unknown';
    }

    // Chat threshold slider
    const chatThreshold = panel.querySelector('#mop-chat-threshold');
    const chatThresholdValue = panel.querySelector('#mop-chat-threshold-value');
    if (chatThreshold && chatThresholdValue) {
      chatThreshold.addEventListener('input', () => {
        chatThresholdValue.textContent = chatThreshold.value;
      });
    }
    // Extension list
    renderExtensionList(panel);

    // Buttons
    const applyBtn = panel.querySelector('#mop-apply');
    const resetBtn = panel.querySelector('#mop-reset');
    const selectAllBtn = panel.querySelector('#mop-select-all');
    const selectNoneBtn = panel.querySelector('#mop-select-none');
    const refreshBtn = panel.querySelector('#mop-refresh-ext');
    const saveChatBtn = panel.querySelector('#mop-save-chat-override');
    const exportBtn = panel.querySelector('#mop-export');
    const importBtn = panel.querySelector('#mop-import');
    const importFile = panel.querySelector('#mop-import-file');

    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        saveSettingsFromUI(panel);
        applyAll();
        if (typeof toastr !== 'undefined') {
          toastr.success('Settings applied successfully!', EXT_DISPLAY);
        }
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to reset all settings to defaults?')) {
          settings = { ...DEFAULTS };
          chatOverrides = {};
          saveSettings();
          location.reload();
        }
      });
    }

    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', () => {
        panel.querySelectorAll('.mop-ext-checkbox').forEach(cb => cb.checked = true);
      });
    }

    if (selectNoneBtn) {
      selectNoneBtn.addEventListener('click', () => {
        panel.querySelectorAll('.mop-ext-checkbox').forEach(cb => cb.checked = false);
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {        detectExtensions();
        renderExtensionList(panel);
      });
    }

    if (saveChatBtn) {
      saveChatBtn.addEventListener('click', () => {
        const chatThreshold = panel.querySelector('#mop-chat-threshold');
        if (chatThreshold && currentChatId) {
          chatOverrides[currentChatId] = {
            threshold: parseInt(chatThreshold.value),
            virtualize: settings.virtualize,
            hideAvatars: settings.hideAvatars
          };
          saveSettings();
          if (typeof toastr !== 'undefined') {
            toastr.success('Chat override saved!', EXT_DISPLAY);
          }
        }
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', exportSettings);
    }

    if (importBtn && importFile) {
      importBtn.addEventListener('click', () => importFile.click());
      importFile.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          importSettings(e.target.files[0]);
        }
      });
    }

    // Start stats update
    if (statsInterval) clearInterval(statsInterval);
    statsInterval = setInterval(updateStats, 2000);
    updateStats();
    updatePerformanceDisplay();
    detectCurrentTheme();
  }

  function renderExtensionList(panel) {
    const listEl = panel.querySelector('#mop-ext-list');
    if (!listEl) return;

    if (extensionList.length === 0) {
      listEl.innerHTML = '<div class="mop-loading">No extensions detected</div>';
      return;    }

    listEl.innerHTML = '';
    extensionList.forEach(ext => {
      const item = document.createElement('div');
      item.className = 'mop-ext-item';

      const isChecked = settings.optimizedExtensions.includes(ext.name);

      item.innerHTML = `
        <label>
          <input type="checkbox" class="mop-checkbox mop-ext-checkbox" data-ext="${ext.name}" ${isChecked ? 'checked' : ''}>
          <span class="mop-ext-name">${ext.displayName}</span>
        </label>
      `;

      listEl.appendChild(item);
    });
  }

  function saveSettingsFromUI(panel) {
    const fields = {
      enabled: '#mop-enabled',
      autoDetect: '#mop-auto-detect',
      virtualize: '#mop-virtualize',
      threshold: '#mop-threshold',
      lockViewport: '#mop-lock-viewport',
      stripAnimations: '#mop-strip-animations',
      hideAvatars: '#mop-hide-avatars',
      lazyLoad: '#mop-lazy-load',
      lazyProfile: '#mop-lazy-profile',
      aggressiveCss: '#mop-aggressive-css',
      themeDetect: '#mop-theme-detect',
      perChat: '#mop-per-chat',
      debug: '#mop-debug'
    };

    Object.entries(fields).forEach(([key, selector]) => {
      const el = panel.querySelector(selector);
      if (el) {
        if (el.type === 'checkbox') {
          settings[key] = el.checked;
        } else if (el.type === 'range') {
          settings[key] = parseInt(el.value);
        }
      }
    });

    settings.optimizedExtensions = [];
    panel.querySelectorAll('.mop-ext-checkbox:checked').forEach(cb => {      settings.optimizedExtensions.push(cb.dataset.ext);
    });

    saveSettings();
  }

  // ─── Apply All Optimizations ─────────────────────────────────────────────────
  function applyAll() {
    if (!settings.enabled) {
      restoreAllArchived();
      document.body.classList.remove('mop-viewport-locked', 'mop-no-anim', 'mop-hide-avatars', 'mop-lazy-profile');
      return;
    }

    if (settings.autoDetect) {
      detectDevicePerformance();
    }

    applyChatOverride();
    injectCSS();
    setupViewportLock();

    document.body.classList.toggle('mop-no-anim', settings.stripAnimations);
    document.body.classList.toggle('mop-hide-avatars', settings.hideAvatars);
    document.body.classList.toggle('mop-lazy-profile', settings.lazyProfile);

    virtualizeChat();
    enforceLazyLoad();
    enforceLazyLoadProfile();

    if (settings.debug) {
      console.log(`[${EXT_DISPLAY}] Applied optimizations:`, settings);
    }
  }

  // ─── SillyTavern Event Listeners ─────────────────────────────────────────────
  function initSTListeners() {
    if (typeof eventSource === 'undefined') return;

    eventSource.on('MESSAGE_RECEIVED', () => {
      setTimeout(() => {
        virtualizeChat();
        enforceLazyLoad();
        enforceLazyLoadProfile();
      }, 150);
    });

    eventSource.on('CHAT_CHANGED', () => {
      restoreAllArchived();
      currentChatId = getCurrentChatId();      applyChatOverride();
      setTimeout(virtualizeChat, 200);
    });

    eventSource.on('CHAT_DELETED', () => {
      restoreAllArchived();
    });
  }

  // ─── Initialize ──────────────────────────────────────────────────────────────
  function init() {
    loadSettings();
    detectExtensions();

    setTimeout(() => {
      applyAll();
      initSTListeners();
      initSettingsUI();
    }, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
