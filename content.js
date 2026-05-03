// LeetCode 题单导航助手 - Content Script v1.2.0

(function () {
  'use strict';

  const SIDEBAR_MIN_W = 180;
  const SIDEBAR_MAX_W = 400;
  const SIDEBAR_DEFAULT_W = 240;
  const STORAGE_KEY = 'lc_nav_width';
  const COLLAPSE_VIEWPORT = 960; // 视口宽度小于此值时自动折叠

  let sidebar = null;
  let toggleBtn = null;
  let resizeHandle = null;
  let isCollapsed = false;
  let sidebarWidth = SIDEBAR_DEFAULT_W;
  let observer = null;
  let scrollHighlightTimer = null;
  let bodyStyleEl = null;

  // ── 初始化 ──────────────────────────────────────────────
  function init() {
    loadWidth();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', trySetup);
    } else {
      trySetup();
    }

    // 监听 SPA 路由变化
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(trySetup, 1500);
      }
    }).observe(document.body, { childList: true, subtree: true });

    // 视口缩放 / 窗口大小变化时重新评估
    window.addEventListener('resize', onViewportResize, { passive: true });
  }

  function loadWidth() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) sidebarWidth = Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, parseInt(stored)));
    } catch (_) {}
  }

  function saveWidth(w) {
    try { localStorage.setItem(STORAGE_KEY, w); } catch (_) {}
  }

  // ── 视口响应 ─────────────────────────────────────────────
  function getAdaptiveWidth() {
    // 视口宽度的 20%，但限制在 min/max 之间，同时不超过视口的 35%
    const vw = window.innerWidth;
    const ratio = Math.min(sidebarWidth, vw * 0.28);
    return Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, ratio));
  }

  function shouldAutoCollapse() {
    return window.innerWidth < COLLAPSE_VIEWPORT;
  }

  function onViewportResize() {
    if (!sidebar) return;
    const w = getAdaptiveWidth();
    applySidebarWidth(w);
    if (shouldAutoCollapse() && !isCollapsed) {
      setCollapsed(true, false); // 静默折叠，不保存状态
    }
  }

  // ── 应用宽度 ─────────────────────────────────────────────
  function applySidebarWidth(w) {
    if (!sidebar) return;
    sidebar.style.width = w + 'px';
    if (!isCollapsed) {
      toggleBtn.style.left = w + 'px';
      pushBodyContent(w);
    }
  }

  function pushBodyContent(w) {
    if (!bodyStyleEl) {
      bodyStyleEl = document.createElement('style');
      bodyStyleEl.id = 'lc-nav-body-offset';
      document.head.appendChild(bodyStyleEl);
    }
    // 只推 body 的第一个直接子容器（LeetCode 的主 wrapper）
    // 用 margin 而非 padding，避免影响背景色
    bodyStyleEl.textContent = `
      body > #app,
      body > .App,
      body > [id="__next"],
      body > div[class*="main"],
      body > div[class*="layout"] {
        transition: margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        margin-left: ${isCollapsed ? 0 : w}px !important;
      }
    `;
  }

  function clearBodyContent() {
    if (bodyStyleEl) {
      bodyStyleEl.textContent = '';
    }
  }

  // ── 折叠控制 ─────────────────────────────────────────────
  function setCollapsed(val, animate = true) {
    isCollapsed = val;
    if (!animate) sidebar.style.transition = 'none';
    sidebar.classList.toggle('collapsed', isCollapsed);
    setTimeout(() => { if (sidebar) sidebar.style.transition = ''; }, 10);

    const w = getAdaptiveWidth();
    toggleBtn.style.left = isCollapsed ? '0px' : w + 'px';
    isCollapsed ? clearBodyContent() : pushBodyContent(w);
  }

  function toggleSidebar() {
    setCollapsed(!isCollapsed);
  }

  // ── 侧边栏创建 ───────────────────────────────────────────
  function isDiscussionPage() {
    return (
      location.href.includes('/discuss/') ||
      location.href.includes('/topic/') ||
      location.href.includes('/post/')
    );
  }

  function trySetup() {
    if (!isDiscussionPage()) { removeSidebar(); return; }
    setTimeout(setupSidebar, 800);
  }

  function removeSidebar() {
    if (sidebar) { sidebar.remove(); sidebar = null; }
    if (toggleBtn) { toggleBtn.remove(); toggleBtn = null; }
    if (observer) { observer.disconnect(); observer = null; }
    clearBodyContent();
  }

  function getArticleContainer() {
    const selectors = [
      '.topic-content',
      '.discuss-markdown-container',
      '[class*="content__"]',
      '[class*="post-content"]',
      '.post-body',
      'article',
      '[class*="topic__"]',
      '.markdown-body',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 100) return el;
    }
    const divs = Array.from(document.querySelectorAll('div'));
    return divs.find(d => d.querySelectorAll('h1,h2,h3,h4').length >= 2) || null;
  }

  function extractHeadings(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .filter(h => h.textContent.trim().length > 0)
      .filter(h => !h.closest('pre, code'))
      .map((h, i) => {
        if (!h.id) h.id = `lc-nav-heading-${i}`;
        return { level: parseInt(h.tagName[1]), text: h.textContent.trim(), el: h, id: h.id };
      });
  }

  function getMinLevel(headings) {
    return headings.length ? Math.min(...headings.map(h => h.level)) : 1;
  }

  function createSidebar(headings) {
    removeSidebar();
    if (headings.length === 0) return;

    const minLevel = getMinLevel(headings);
    const w = getAdaptiveWidth();

    // ── 切换按钮 ──
    toggleBtn = document.createElement('div');
    toggleBtn.id = 'lc-nav-toggle';
    toggleBtn.title = '切换目录导航';
    toggleBtn.style.left = w + 'px';
    toggleBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="6" x2="21" y2="6"/>
        <line x1="3" y1="12" x2="15" y2="12"/>
        <line x1="3" y1="18" x2="18" y2="18"/>
      </svg>`;
    toggleBtn.addEventListener('click', toggleSidebar);
    document.body.appendChild(toggleBtn);

    // ── 侧边栏主体 ──
    sidebar = document.createElement('div');
    sidebar.id = 'lc-nav-sidebar';
    sidebar.style.width = w + 'px';

    // 标题区
    const header = document.createElement('div');
    header.className = 'lc-nav-header';
    header.innerHTML = `
      <span class="lc-nav-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <path d="M4 6h16M4 10h16M4 14h8M4 18h10"/>
        </svg>
        目录导航
      </span>
      <button class="lc-nav-close" title="关闭">✕</button>`;
    header.querySelector('.lc-nav-close').addEventListener('click', toggleSidebar);

    // 搜索框
    const searchWrap = document.createElement('div');
    searchWrap.className = 'lc-nav-search-wrap';
    searchWrap.innerHTML = `
      <input type="text" class="lc-nav-search" placeholder="搜索标题..." />
      <span class="lc-nav-search-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
      </span>`;

    // 目录列表
    const list = document.createElement('div');
    list.className = 'lc-nav-list';

    headings.forEach(({ level, text, id }) => {
      const item = document.createElement('div');
      item.className = `lc-nav-item lc-nav-level-${level - minLevel + 1}`;
      item.setAttribute('data-id', id);
      item.setAttribute('data-text', text.toLowerCase());
      item.title = text;

      const indent = (level - minLevel) * 12;
      item.style.paddingLeft = `${12 + indent}px`;

      const dot = document.createElement('span');
      dot.className = 'lc-nav-dot';

      const label = document.createElement('span');
      label.className = 'lc-nav-label';
      label.textContent = text;

      item.appendChild(dot);
      item.appendChild(label);

      item.addEventListener('click', () => {
        const target = document.getElementById(id);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          document.querySelectorAll('.lc-nav-item.active').forEach(i => i.classList.remove('active'));
          item.classList.add('active');
        }
      });
      list.appendChild(item);
    });

    // 搜索过滤
    searchWrap.querySelector('.lc-nav-search').addEventListener('input', e => {
      const q = e.target.value.toLowerCase().trim();
      list.querySelectorAll('.lc-nav-item').forEach(item => {
        item.style.display = !q || item.getAttribute('data-text').includes(q) ? '' : 'none';
      });
    });

    // 底部统计
    const footer = document.createElement('div');
    footer.className = 'lc-nav-footer';
    footer.textContent = `共 ${headings.length} 个标题`;

    // ── 拖拽调整宽度 ──
    resizeHandle = document.createElement('div');
    resizeHandle.id = 'lc-nav-resize';
    resizeHandle.title = '拖拽调整宽度';
    setupResizeDrag(resizeHandle);

    sidebar.appendChild(header);
    sidebar.appendChild(searchWrap);
    sidebar.appendChild(list);
    sidebar.appendChild(footer);
    sidebar.appendChild(resizeHandle);
    document.body.appendChild(sidebar);

    pushBodyContent(w);
    setupScrollHighlight(headings);

    // 小屏幕自动折叠
    if (shouldAutoCollapse()) setCollapsed(true, false);
    else isCollapsed = false;
  }

  // ── 拖拽调整宽度 ─────────────────────────────────────────
  function setupResizeDrag(handle) {
    let startX, startW;

    function onMouseMove(e) {
      const newW = Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, startW + e.clientX - startX));
      sidebarWidth = newW;
      applySidebarWidth(newW);
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveWidth(sidebarWidth);
    }

    handle.addEventListener('mousedown', e => {
      startX = e.clientX;
      startW = getAdaptiveWidth();
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    });

    // 触摸支持
    handle.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      startW = getAdaptiveWidth();
    }, { passive: true });

    handle.addEventListener('touchmove', e => {
      const newW = Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, startW + e.touches[0].clientX - startX));
      sidebarWidth = newW;
      applySidebarWidth(newW);
    }, { passive: true });

    handle.addEventListener('touchend', () => saveWidth(sidebarWidth), { passive: true });
  }

  // ── 滚动高亮 ─────────────────────────────────────────────
  function setupScrollHighlight(headings) {
    const listEl = sidebar && sidebar.querySelector('.lc-nav-list');
    if (!listEl) return;

    window.addEventListener('scroll', () => {
      clearTimeout(scrollHighlightTimer);
      scrollHighlightTimer = setTimeout(() => {
        const scrollY = window.scrollY + 120;
        let current = null;
        for (const { el, id } of headings) {
          if (el.offsetTop <= scrollY) current = id;
        }
        listEl.querySelectorAll('.lc-nav-item').forEach(item => {
          const active = item.getAttribute('data-id') === current;
          item.classList.toggle('active', active);
          if (active) item.scrollIntoView({ block: 'nearest' });
        });
      }, 50);
    }, { passive: true });
  }

  // ── 内容监听 ─────────────────────────────────────────────
  function setupSidebar() {
    const container = getArticleContainer();
    if (!container) {
      setTimeout(() => {
        const c = getArticleContainer();
        if (c) { createSidebar(extractHeadings(c)); watchContent(c); }
      }, 2000);
      return;
    }
    const headings = extractHeadings(container);
    if (headings.length > 0) createSidebar(headings);
    watchContent(container);
  }

  function watchContent(container) {
    if (observer) observer.disconnect();
    let timer = null;
    observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const h = extractHeadings(container);
        if (h.length > 0) createSidebar(h);
      }, 500);
    });
    observer.observe(container, { childList: true, subtree: true });
  }

  init();
})();
