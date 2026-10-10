// ==UserScript==
// @name         login-keyboard-shortcut
// @name:ko      login-keyboard-shortcut
// @namespace    https://github.com/Sleepy0Duck5/login-keyboard-shortcut
// @version      1.5.1
// @homepageURL  https://github.com/Sleepy0Duck5/login-keyboard-shortcut
// @downloadURL  https://raw.githubusercontent.com/Sleepy0Duck5/login-keyboard-shortcut/main/login-keyboard-shortcut.user.js
// @updateURL    https://raw.githubusercontent.com/Sleepy0Duck5/login-keyboard-shortcut/main/login-keyboard-shortcut.user.js
// @description  Press Ctrl+Shift+U to open a login URL or activate a login button. Shows a three-second result toast.
// @description:ko Ctrl+Shift+U로 로그인 URL을 열거나 로그인 버튼을 누르고, 실행 결과를 3초간 표시합니다.
// @match        http://*/*
// @match        https://*/*
// @run-at       document-end
// @noframes
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.info
// ==/UserScript==

(() => {
    'use strict';

    const HOTKEY_LABEL = 'Ctrl+Shift+U';
    const STORAGE_KEY = 'login-shortcut-pending-navigation';
    const TOAST_ID = 'login-shortcut-result-toast';
    const MODAL_ID = 'login-shortcut-info-modal';
    const PAGE_INSTANCE_ID = `${Date.now()}-${Math.random()}`;
    const TOAST_DURATION = 3000;
    const NAVIGATION_TIMEOUT = 1200;
    const NAVIGATION_STATE_TTL = 30000;

    const positiveTextPattern = /(로그인|log[\s_-]?in|sign[\s_-]?in)/i;
    const positiveUrlPattern = /(?:^|[\/_?&=.-])(login|log-in|signin|sign-in|auth)(?:[\/_?&=.#-]|$)/i;
    const negativePattern = /(로그아웃|log[\s_-]?out|회원가입|가입하기|sign[\s_-]?up|register|join)/i;

    function getScriptInfo() {
        return {
            name: globalThis.GM?.info?.script?.name || 'login-keyboard-shortcut',
            version: globalThis.GM?.info?.script?.version || '1.5.1'
        };
    }

    async function storageGet() {
        try {
            if (globalThis.GM?.getValue) return await GM.getValue(STORAGE_KEY, null);
        } catch (error) {
            console.warn('[로그인 단축키] 저장값 읽기 실패:', error);
        }
        try {
            return JSON.parse(sessionStorage.getItem(STORAGE_KEY));
        } catch {
            return null;
        }
    }

    async function storageSet(value) {
        try {
            if (globalThis.GM?.setValue) {
                await GM.setValue(STORAGE_KEY, value);
                return;
            }
        } catch (error) {
            console.warn('[로그인 단축키] 저장값 기록 실패:', error);
        }
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    }

    async function storageDelete() {
        try {
            if (globalThis.GM?.deleteValue) {
                await GM.deleteValue(STORAGE_KEY);
                return;
            }
        } catch (error) {
            console.warn('[로그인 단축키] 저장값 삭제 실패:', error);
        }
        sessionStorage.removeItem(STORAGE_KEY);
    }

    function isVisible(element) {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) !== 0 &&
            rect.width > 0 &&
            rect.height > 0;
    }

    function isInteractive(element) {
        const nativeInteractive = element.matches(
            'a, button, input[type="button"], input[type="submit"]'
        );
        const semanticInteractive = ['button', 'link'].includes(
            element.getAttribute('role')?.toLowerCase()
        );
        const scriptedInteractive = element.hasAttribute('onclick') || element.tabIndex >= 0;
        const styledInteractive = getComputedStyle(element).cursor === 'pointer';

        return nativeInteractive || semanticInteractive || scriptedInteractive || styledInteractive;
    }

    function getCandidate(element) {
        if (!isVisible(element) || !isInteractive(element)) return null;

        const href = element.getAttribute('href');
        let url = null;
        if (href && href.trim() && href.trim() !== '#') {
            try {
                url = new URL(href, location.href);
                if (!['http:', 'https:'].includes(url.protocol)) url = null;
            } catch {
                url = null;
            }
        }

        const visibleText = (
            [element.innerText, element.value, element.textContent]
                .find(value => typeof value === 'string' && value.trim()) ?? ''
        )
            .replace(/\s+/g, ' ')
            .trim();
        const accessibleText = [
            element.getAttribute('aria-label'),
            element.getAttribute('title'),
            element.getAttribute('alt')
        ]
            .filter(value => typeof value === 'string')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        const attributeText = [
            element.id,
            element.getAttribute('name'),
            typeof element.className === 'string' ? element.className : '',
            element.getAttribute('data-testid'),
            element.getAttribute('data-action')
        ]
            .filter(value => typeof value === 'string')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        const text = [
            visibleText,
            accessibleText
        ]
            .filter(value => typeof value === 'string')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

        const combined = `${text} ${attributeText} ${url?.href ?? ''}`;
        if (negativePattern.test(combined)) return null;

        const textMatches = positiveTextPattern.test(text);
        const attributeMatches = positiveTextPattern.test(attributeText);
        const urlMatches = url
            ? positiveUrlPattern.test(`${url.pathname}${url.search}${url.hash}`)
            : false;
        const passwordForm = element.closest('form')?.querySelector('input[type="password"]');
        if (!textMatches && !attributeMatches && !urlMatches && !passwordForm) return null;

        let score = 0;
        if (/^(로그인|log[\s_-]?in|sign[\s_-]?in)$/i.test(visibleText)) score += 120;
        else if (positiveTextPattern.test(visibleText)) score += 70;
        if (/^(로그인|log[\s_-]?in|sign[\s_-]?in)$/i.test(accessibleText)) score += 100;
        else if (positiveTextPattern.test(accessibleText)) score += 60;
        if (urlMatches) score += 50;
        if (attributeMatches) score += 25;
        if (passwordForm) score += 45;
        if (url?.origin === location.origin) score += 10;
        if (element.matches('button, input[type="button"], input[type="submit"], [role="button"]')) score += 20;

        return { element, url, score };
    }

    function findLoginTarget() {
        return [...document.querySelectorAll(
            'a, button, input[type="button"], input[type="submit"], [role="button"], [role="link"], [onclick], [tabindex]'
        )]
            .map(getCandidate)
            .filter(Boolean)
            .sort((a, b) =>
                b.score - a.score ||
                a.element.getBoundingClientRect().top - b.element.getBoundingClientRect().top
            )[0] ?? null;
    }

    function showInfoModal() {
        const existing = document.getElementById(MODAL_ID);
        if (existing) {
            existing.shadowRoot?.getElementById('close')?.focus();
            return;
        }

        const { name, version } = getScriptInfo();
        const host = document.createElement('div');
        host.id = MODAL_ID;
        host.style.cssText = [
            'all: initial',
            'position: fixed',
            'inset: 0',
            'z-index: 2147483647'
        ].join(';');

        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                #backdrop {
                    box-sizing: border-box;
                    position: fixed;
                    inset: 0;
                    display: grid;
                    place-items: center;
                    padding: 20px;
                    background: rgba(7, 9, 13, .58);
                    backdrop-filter: blur(3px);
                    animation: fade-in .15s ease;
                }
                #dialog {
                    box-sizing: border-box;
                    width: min(390px, 100%);
                    overflow: hidden;
                    border: 1px solid rgba(255,255,255,.14);
                    border-radius: 16px;
                    background: #1b1e25;
                    color: #fff;
                    box-shadow: 0 24px 70px rgba(0,0,0,.45);
                    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
                    animation: modal-in .18s ease;
                }
                header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 18px 20px;
                    border-bottom: 1px solid rgba(255,255,255,.10);
                }
                h2 { margin: 0; font-size: 17px; line-height: 1.3; }
                #close {
                    all: unset;
                    display: grid;
                    width: 30px;
                    height: 30px;
                    place-items: center;
                    border-radius: 8px;
                    color: #c7cbd4;
                    font: 22px/1 system-ui, sans-serif;
                    cursor: pointer;
                }
                #close:hover, #close:focus-visible {
                    background: rgba(255,255,255,.10);
                    color: #fff;
                    outline: 2px solid transparent;
                }
                dl {
                    display: grid;
                    grid-template-columns: 92px 1fr;
                    gap: 14px 12px;
                    margin: 0;
                    padding: 20px;
                    font-size: 14px;
                }
                dt { color: #9399a6; }
                dd { margin: 0; color: #fff; font-weight: 600; overflow-wrap: anywhere; }
                @keyframes fade-in { from { opacity: 0; } }
                @keyframes modal-in { from { opacity: 0; transform: translateY(8px) scale(.98); } }
            </style>
            <div id="backdrop">
                <section id="dialog" role="dialog" aria-modal="true" aria-labelledby="title">
                    <header>
                        <h2 id="title">확장 스크립트 정보</h2>
                        <button id="close" type="button" aria-label="닫기" title="닫기">×</button>
                    </header>
                    <dl>
                        <dt>스크립트 이름</dt><dd>${name}</dd>
                        <dt>스크립트 버전</dt><dd>${version}</dd>
                    </dl>
                </section>
            </div>
        `;

        const closeModal = () => {
            document.removeEventListener('keydown', onKeyDown, true);
            host.remove();
        };
        const onKeyDown = event => {
            if (event.key === 'Escape') closeModal();
        };

        shadow.getElementById('close').addEventListener('click', closeModal);
        shadow.getElementById('backdrop').addEventListener('click', event => {
            if (event.target.id === 'backdrop') closeModal();
        });
        document.addEventListener('keydown', onKeyDown, true);
        (document.body || document.documentElement).appendChild(host);
        shadow.getElementById('close').focus();
    }

    function showToast(message, type) {
        document.getElementById(TOAST_ID)?.remove();

        const host = document.createElement('div');
        host.id = TOAST_ID;
        host.style.cssText = [
            'all: initial',
            'position: fixed',
            'right: 20px',
            'bottom: 20px',
            'z-index: 2147483647',
            'pointer-events: auto'
        ].join(';');

        const shadow = host.attachShadow({ mode: 'open' });
        const accent = type === 'success' ? '#45d483' : type === 'warning' ? '#ffbc42' : '#ff5d73';
        const icon = type === 'success' ? '✓' : type === 'warning' ? '!' : '×';

        shadow.innerHTML = `
            <style>
                #toast {
                    box-sizing: border-box; display: flex; align-items: center; gap: 10px;
                    max-width: min(390px, calc(100vw - 40px)); padding: 12px 14px;
                    border: 1px solid rgba(255,255,255,.15); border-left: 4px solid ${accent};
                    border-radius: 11px; background: rgba(24,26,32,.95); color: #fff;
                    box-shadow: 0 10px 32px rgba(0,0,0,.30);
                    font: 500 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
                    opacity: 0; transform: translateY(10px);
                    animation: enter .18s ease forwards, leave .2s ease ${TOAST_DURATION - 200}ms forwards;
                    backdrop-filter: blur(8px); cursor: pointer; user-select: none;
                }
                #icon {
                    display: grid; flex: 0 0 22px; width: 22px; height: 22px; place-items: center;
                    border-radius: 50%; background: ${accent}; color: #15171b; font-weight: 800;
                }
                kbd {
                    margin-left: 4px; padding: 2px 5px; border: 1px solid rgba(255,255,255,.22);
                    border-bottom-width: 2px; border-radius: 5px; background: rgba(255,255,255,.08);
                    font: 600 10px/1.2 system-ui, sans-serif;
                }
                @keyframes enter { to { opacity: 1; transform: translateY(0); } }
                @keyframes leave { to { opacity: 0; transform: translateY(8px); } }
            </style>
            <div id="toast" role="button" tabindex="0" aria-label="${message} 확장 스크립트 정보 보기">
                <span id="icon">${icon}</span>
                <span>${message} <kbd>${HOTKEY_LABEL}</kbd></span>
            </div>
        `;

        (document.body || document.documentElement).appendChild(host);
        const toast = shadow.getElementById('toast');
        toast.addEventListener('click', showInfoModal);
        toast.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                showInfoModal();
            }
        });
        setTimeout(() => host.remove(), TOAST_DURATION);
    }

    async function activateLoginShortcut() {
        const candidate = findLoginTarget();

        if (!candidate) {
            showToast('로그인 URL이나 버튼을 찾지 못했습니다.', 'error');
            console.warn('[로그인 단축키] 로그인 URL이나 버튼을 찾지 못했습니다.');
            return;
        }

        if (!candidate.url) {
            try {
                candidate.element.click();
                showToast('로그인 버튼을 눌렀습니다.', 'success');
                console.info('[로그인 단축키] URL 없는 로그인 버튼 클릭:', candidate.element);
            } catch (error) {
                showToast('로그인 버튼은 찾았지만 누르지 못했습니다.', 'warning');
                console.warn('[로그인 단축키] 로그인 버튼 클릭 실패:', error);
            }
            return;
        }

        const pending = {
            instanceId: PAGE_INSTANCE_ID,
            sourceUrl: location.href,
            targetUrl: candidate.url.href,
            createdAt: Date.now()
        };

        await storageSet(pending);
        console.info('[로그인 단축키] 로그인 URL 발견:', candidate.url.href);

        try {
            location.assign(candidate.url.href);
        } catch (error) {
            await storageDelete();
            showToast('로그인 URL은 찾았지만 이동하지 못했습니다.', 'warning');
            console.warn('[로그인 단축키] URL 이동 실패:', error);
            return;
        }

        setTimeout(async () => {
            if (document.visibilityState !== 'hidden') {
                const saved = await storageGet();
                if (saved?.instanceId === PAGE_INSTANCE_ID) {
                    await storageDelete();
                    if (location.href !== saved.sourceUrl) {
                        showToast('로그인 URL을 찾아 이동했습니다.', 'success');
                        console.info('[로그인 단축키] 같은 문서에서 URL 이동 완료:', saved.targetUrl);
                    } else {
                        showToast('로그인 URL은 찾았지만 이동하지 않았습니다.', 'warning');
                        console.warn('[로그인 단축키] URL 이동이 감지되지 않았습니다.');
                    }
                }
            }
        }, NAVIGATION_TIMEOUT);
    }

    async function reportCompletedNavigation() {
        const pending = await storageGet();
        if (!pending) return;

        const isRecent = Date.now() - pending.createdAt < NAVIGATION_STATE_TTL;
        const isNewDocument = pending.instanceId !== PAGE_INSTANCE_ID;

        if (isRecent && isNewDocument) {
            showToast('로그인 URL을 찾아 이동했습니다.', 'success');
            console.info('[로그인 단축키] URL 이동 완료:', pending.targetUrl);

            // 로그인 과정에서 중간 페이지를 여러 번 거칠 수 있다. 알림이 끝까지
            // 표시된 문서에서만 상태를 지워 최종 페이지에서도 결과를 볼 수 있게 한다.
            setTimeout(async () => {
                if (document.visibilityState === 'hidden') return;

                const saved = await storageGet();
                if (
                    saved?.instanceId === pending.instanceId &&
                    saved?.createdAt === pending.createdAt
                ) {
                    await storageDelete();
                }
            }, TOAST_DURATION);
        } else if (!isRecent) {
            await storageDelete();
        }
    }

    window.addEventListener('keydown', event => {
        if (
            event.ctrlKey && event.shiftKey && event.code === 'KeyU' &&
            !event.altKey && !event.metaKey
        ) {
            event.preventDefault();
            event.stopImmediatePropagation();
            void activateLoginShortcut();
        }
    }, true);

    void reportCompletedNavigation();
})();

