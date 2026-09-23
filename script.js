// script.js

// 触摸设备检测：手机/平板降低粒子与特效强度、切换触摸提示文案（桌面端玩法完全不变）
const IS_TOUCH = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
    ('ontouchstart' in window);

// 移动设备判定（多信号综合，修复部分手机浏览器误判为电脑的问题）。
// 单一依赖 (hover:none)+(pointer:coarse) 在某些国产浏览器 / "电脑版 UA"模式下会失真，
// 导致"请横屏体验"提示与虚拟方向键全部不出现。现改为多信号取并集：
//   ① 媒体查询（原判断，保留）② 触摸能力 maxTouchPoints / msMaxTouchPoints / ontouchstart
//   ③ 移动端 UA 特征 ④ iPadOS（UA 伪装成 Mac 但带多点触摸）⑤ 物理屏幕较小。
// 触屏 PC（Windows 笔记本等）：有触摸但 UA 非移动端且物理屏幕大 → 不会误判，桌面端零影响。
const IS_MOBILE = (() => {
    const mq = typeof window.matchMedia === 'function' &&
        window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    const maxTouch = (navigator.maxTouchPoints || navigator.msMaxTouchPoints || 0);
    const hasTouch = maxTouch > 0 || ('ontouchstart' in window);
    const ua = navigator.userAgent || '';
    const mobileUA = /Android|iPhone|iPod|Mobile|HarmonyOS/i.test(ua);
    const iPadOS = /Macintosh/i.test(ua) && maxTouch > 1; // iPadOS 13+ 默认伪装成 Mac
    const scr = window.screen || {};
    const smallScreen = Math.min(scr.width || 9999, scr.height || 9999) <= 850;
    return mq || (hasTouch && (mobileUA || iPadOS || smallScreen));
})();

// ============================================================
// 移动端沉浸式全屏（第三/四轮）：绑定在主菜单「开始冒险」按钮的
// click 处理函数第一条语句——浏览器要求全屏请求发生在用户手势的
// 同步调用链内（不能 setTimeout/await 延迟，否则手势失效被拒绝）。
// Android 系浏览器（Chrome/Edge/主流国产内核）支持 Fullscreen API +
// screen.orientation.lock：成功后隐藏地址栏/工具栏并锁定横屏，
// 游戏真正占满整块屏幕、进入沉浸模式。
// 微信 iOS（WKWebView）/ iOS Safari 不支持全屏 API：能力检测不通过或
// Promise 被拒时全部静默降级（不报错、无副作用），继续沿用现有的
// --app-height + 横屏压缩布局方案，游戏照常运行。
// 全屏切换会触发 window resize → 方向状态机自动更新 --app-height 并
// resizeCanvas，画布无需额外处理即占满新的可用区域。
// 仅在「开始冒险」请求一次：进入关卡/重试只沿用已有全屏状态，
// 用户主动退出全屏后不反复强制重进。电脑端直接 return，行为零变化。
// ============================================================
function requestImmersive() {
    if (!IS_MOBILE) return; // 电脑端完全不做任何事
    // 已处于全屏状态：不重复请求（本次起主菜单各入口按钮都会触发申请；
    // 用户主动退出全屏后再点击入口按钮，仍会重新申请全屏）
    if (document.fullscreenElement || document.webkitFullscreenElement ||
        document.mozFullScreenElement || document.msFullscreenElement) return;
    const el = document.documentElement;
    const reqFs = el.requestFullscreen || el.webkitRequestFullscreen ||
        el.mozRequestFullScreen || el.msRequestFullscreen;
    if (!reqFs) return; // 不支持全屏 API（iOS 系）：静默跳过
    try {
        const p = reqFs.call(el);
        if (p && typeof p.then === 'function') {
            p.then(() => {
                // 全屏成功后再尝试锁定横屏（部分内核要求全屏状态才允许锁定；
                // 锁定失败同样静默——用户手动横屏 + 现有状态机仍可正常游戏）
                try {
                    const lockP = window.screen && screen.orientation &&
                        typeof screen.orientation.lock === 'function' &&
                        screen.orientation.lock('landscape');
                    if (lockP && typeof lockP.catch === 'function') lockP.catch(() => {});
                } catch (e) { /* 忽略 */ }
            }).catch(() => { /* 用户拒绝或内核限制：静默降级 */ });
        }
    } catch (e) { /* 忽略 */ }
}

// ============================================================
// 手机端难度平衡（仅 IS_MOBILE 生效；PC 端全部取右列原值，零变化）：
// 触屏精度低于键盘 + 手机画布更矮（64px 障碍占屏比例更大），按以下幅度
// 把手机触控手感向电脑端靠拢。不改玩法/障碍种类/概率/分数/甜品风暴：
//   moveSpeed    玩家移速倍率       0.825 / 1 —— 真机测 5.5 过快易过头，
//                                                 在 1.1 基础上再 ×0.75 → 4.125
//   obstSpeed    障碍水平速度倍率   0.9 / 1   —— 障碍整体慢 10%，更好读轨迹
//   tornadoSpeed 风暴云(龙卷风)追加 0.8 / 1   —— 真机测仍偏快，在 0.9 基础上
//                                                 再 ×0.8（仅风暴云，其他障碍不变）
//   spawnGap     生成安全间距 px    26 / 16   —— 矮屏上减少几乎贴脸的生成组合
//   collectPad   甜品判定外扩 px     8 / 0    —— 只加收集判定，视觉大小不变
//   obstHitbox   障碍碰撞框边长比  0.9 / 1   —— 每边内缩 5%，不明显穿模
// ============================================================
const MOBILE_DIFF = IS_MOBILE ? {
    moveSpeed: 0.825, obstSpeed: 0.9, tornadoSpeed: 0.8,
    spawnGap: 26, collectPad: 8, obstHitbox: 0.9
} : {
    moveSpeed: 1, obstSpeed: 1, tornadoSpeed: 1,
    spawnGap: 16, collectPad: 0, obstHitbox: 1
};

// ============================================================
// 角色衣柜皮肤配置（全局常量，衣橱 UI 与游戏绘制共用）：
// 衣柜选择的是"系列"（classic/mint/star），进入游戏后自动播放该系列 1→2→3 嘴型动画。
// 1/2/3 不是三个独立皮肤，而是吃食物时的三帧嘴型（三系列共用同一套时序）：
//   1 = normal 正常待机（闭嘴） / 2 = eating 吃到食物瞬间张嘴（0.2s）
//   3 = happy 咀嚼结束闭嘴笑脸（0.4s）→ 恢复待机（经典时序，见 advanceFaceState）
// unlockDessert = 解锁条件：累计收集该甜品达 SKIN_UNLOCK_GOAL 解锁整系列；null = 默认解锁。
// 皮肤切换只替换角色 PNG 绘制源，碰撞箱与属性完全不变（见 drawPlayer）。
// ============================================================
const SKINS = {
    classic: {
        name: '经典糯米团', locked: false, unlockDessert: null,
        states: {
            normal: 'assets/经典糯米团1.png',
            eating: 'assets/经典糯米团2.png',
            happy: 'assets/经典糯米团3.png'
        }
    },
    mint: {
        name: '沁凉薄荷', locked: true, unlockDessert: 'mint_soda', // 累计收集薄荷气泡水达标解锁
        states: {
            normal: 'assets/沁凉薄荷1.png',
            eating: 'assets/沁凉薄荷2.png',
            happy: 'assets/沁凉薄荷3.png'
        }
    },
    star: {
        name: '幻彩星糖', locked: true, unlockDessert: 'red_clay',  // 累计收集星糖达标解锁
        states: {
            normal: 'assets/幻彩星糖1.png',
            eating: 'assets/幻彩星糖2.png',
            happy: 'assets/幻彩星糖3.png'
        }
    }
};
// 皮肤系列解锁目标：沿用项目已有的图鉴收藏目标数值（COLLECT_GOAL = 20）
const SKIN_UNLOCK_GOAL = 20;
const DEFAULT_SKIN = 'classic';

// 音效增益配置：甜品收集 / 障碍碰撞两类音效相对基础音量的放大倍数（1 = 不放大）。
// 实际播放音量 = 音效音量设置 × 增益，上限封顶 1.0（HTML5 Audio 满幅，不会数字爆音）。
// 仅作用于这两类音效；click / 风暴云环境音 / BGM 不受影响。
const COLLECT_SFX_GAIN = 2; // 甜品收集（bubble pop / magic sparkle）
const HIT_SFX_GAIN = 2;     // 障碍碰撞（冰裂 / 糖果泡泡的 bubble pop）

const GameManager = (() => {
    let currentScreen = null;
    let selectedOutfit = 'classic'; // 当前装备皮肤系列（值域 = SKINS 的 id），默认：经典糯米团
    let selectedCharacter = 'nacrez'; // Default character
    let selectedLevel = 'level1'; // Default level

    const screens = {
        mainMenu: document.getElementById('main-menu'),
        characterSelection: document.getElementById('character-selection-screen'),
        outfitSelection: document.getElementById('outfit-selection-screen'),
        levelSelection: document.getElementById('level-selection-screen'),
        gameplay: document.getElementById('gameplay-screen'),
        gameOver: document.getElementById('game-over-screen'),
        settings: document.getElementById('settings-screen'),
        about: document.getElementById('about-screen'),
        cgScreen: document.getElementById('cg-screen'),
        dessertDex: document.getElementById('dessert-dex-screen'),
        beastScreen: document.getElementById('beast-screen')
    };

    // 衣橱卡片状态渲染：已装备 → active 高亮 +「已装备」徽标；
    // 已解锁未装备 →「点击装备」；未解锁 → locked +「🔒 收集xx count/goal」。
    // 解锁状态实时从存档数据推导（Game.isSeriesUnlocked），不依赖 HTML 静态类。
    const renderOutfitStates = () => {
        document.querySelectorAll('.outfit-card').forEach((card) => {
            const id = card.dataset.outfit;
            if (!SKINS[id]) return;
            const unlocked = Game.isSeriesUnlocked(id);
            const equipped = unlocked && id === selectedOutfit;
            card.classList.toggle('locked', !unlocked);
            card.classList.toggle('active', equipped);
            const state = card.querySelector('.outfit-state');
            if (state) {
                if (!unlocked) {
                    const p = Game.getSkinProgress(id);
                    state.textContent = `🔒 收集${p.name} ${p.count}/${p.goal}`;
                } else {
                    state.textContent = equipped ? '已装备' : '点击装备';
                }
                state.classList.toggle('state-equipped', equipped);
                state.classList.toggle('state-locked', !unlocked);
            }
        });
    };

    const showScreen = (screenName) => {
        if (currentScreen) {
            currentScreen.classList.remove('active');
        }
        const targetScreen = screens[screenName];
        if (targetScreen) {
            targetScreen.classList.add('active');
            currentScreen = targetScreen;
            if (screenName === 'outfitSelection') {
                // 进入衣橱时刷新各卡状态（当前装备高亮 + 锁定/可装备标识）
                renderOutfitStates();
            }
            if (screenName === 'characterSelection') {
                // 确认角色页：预览跟随衣柜当前选中皮肤（重绘 = 取最新选中系列的 2 号 PNG）
                Game.redrawCharacterHero();
            }
            if (screenName === 'mainMenu') {
                // 开始界面：淡入花园 BGM（首次 1.2s；若已在播则无缝跳过保持进度）
                AudioManager.play('garden', 1200);
            } else if (screenName === 'gameOver') {
                // 游戏结束：当前 BGM 2 秒淡出；返回开始界面时重新淡入花园曲
                AudioManager.fadeOutAll(2000);
            }
        } else {
            console.error(`Screen ${screenName} not found.`);
        }
    };

    const init = () => {
        // Initial screen
        showScreen('mainMenu');

        // 主菜单背景素材接口：assets/menu_bg.png 加载成功则铺满显示，
        // 失败（文件不存在）则保持 CSS 渐变天空 + 云朵占位。替换素材零代码改动。
        const menuBg = document.getElementById('menu-bg');
        if (menuBg) {
            menuBg.src = 'assets/menu_bg.png';
            menuBg.onload = () => { menuBg.hidden = false; };
            menuBg.onerror = () => { menuBg.hidden = true; };
        }

        // Main Menu Buttons
        document.getElementById('start-button').addEventListener('click', () => {
            // 移动端：最早的用户手势（首次点击「开始冒险」）内同步申请沉浸式全屏。
            // 必须是本处理函数第一条语句（同步执行，不用 setTimeout/await，
            // 否则浏览器会判定脱离手势链而拒绝全屏）。失败静默降级，不阻塞进角色选择。
            requestImmersive();
            showScreen('characterSelection');
            console.log("Go to Character Selection");
        });

        document.getElementById('wardrobe-button').addEventListener('click', () => {
            requestImmersive(); // 移动端：主菜单入口手势内同步申请全屏（同「开始冒险」）
            showScreen('outfitSelection');
            console.log("Go to Outfit Selection");
        });

        // Dessert Dex Button
        document.getElementById('dex-button').addEventListener('click', () => {
            requestImmersive(); // 移动端：主菜单入口手势内同步申请全屏
            DessertDexUI.render(); // 每次打开都按最新 DESSERT_DEX 数据重绘（UI 只读取数据）
            showScreen('dessertDex');
            console.log("Go to Dessert Dex");
        });

        // Earthen Beast Info Button（大地兽伙伴：只读信息展示）
        document.getElementById('beast-button').addEventListener('click', () => {
            requestImmersive(); // 移动端：主菜单入口手势内同步申请全屏
            BeastInfoUI.render(); // 每次打开按数据重绘
            showScreen('beastScreen');
            console.log("Go to Earthen Beast Info");
        });

        document.getElementById('level-button').addEventListener('click', () => {
            requestImmersive(); // 移动端：主菜单入口手势内同步申请全屏
            showScreen('levelSelection');
            console.log("Go to Level Selection");
        });

        document.getElementById('settings-button').addEventListener('click', () => {
            requestImmersive(); // 移动端：主菜单入口手势内同步申请全屏
            showScreen('settings');
            console.log("Go to Settings");
        });

        document.getElementById('about-button').addEventListener('click', () => {
            requestImmersive(); // 移动端：主菜单入口手势内同步申请全屏
            showScreen('about');
            console.log("Go to About");
        });

        // 关于页双页签切换：🌿 游戏介绍（薄荷绿）/ ❄️ 制作人员（极光渐变），
        // 单选互斥，纯展示层切换不涉及其它系统
        const aboutTabs = {
            intro: {
                tab: document.getElementById('about-tab-intro'),
                panel: document.getElementById('about-panel-intro')
            },
            credits: {
                tab: document.getElementById('about-tab-credits'),
                panel: document.getElementById('about-panel-credits')
            }
        };
        const setAboutTab = (name) => {
            Object.entries(aboutTabs).forEach(([key, ref]) => {
                const on = key === name;
                ref.tab.classList.toggle('active', on);
                ref.panel.classList.toggle('active', on);
            });
        };
        if (aboutTabs.intro.tab && aboutTabs.credits.tab) {
            aboutTabs.intro.tab.addEventListener('click', () => setAboutTab('intro'));
            aboutTabs.credits.tab.addEventListener('click', () => setAboutTab('credits'));
        }

        // Character Selection Screen Buttons（角色选择页：主按钮=确认角色 → 关卡选择；
        // 左上箭头返回主菜单。图鉴/设置仅保留主菜单入口，页内二级菜单已按需求移除）
        document.getElementById('confirm-character-button').addEventListener('click', () => {
            showScreen('levelSelection'); // 角色确认后直接进入关卡选择，换装走衣柜入口
            console.log("Character Confirmed, Go to Level Selection");
        });

        document.getElementById('char-back-arrow').addEventListener('click', () => {
            showScreen('mainMenu');
        });

        // Outfit Selection Screen Buttons（衣柜：独立装扮功能，换装后回主菜单，不进关卡）
        document.getElementById('confirm-outfit-button').addEventListener('click', () => {
            showScreen('mainMenu'); // 完成换装返回主界面，是否开始游戏由玩家自己决定
            console.log(`Outfit Saved: ${selectedOutfit}, Back to Main Menu`);
        });

        document.getElementById('back-to-main-menu-from-outfit-selection').addEventListener('click', () => {
            showScreen('mainMenu');
        });

        // Level Selection Screen Buttons（点击关卡卡片直接开始游戏，无独立"开始关卡"步骤）
        document.getElementById('back-to-main-menu-from-level-selection').addEventListener('click', () => {
            showScreen('mainMenu');
        });

        // Dessert Dex Screen Back Button
        document.getElementById('back-to-main-menu-from-dex').addEventListener('click', () => {
            showScreen('mainMenu');
        });

        // Beast Info Screen Back Button
        document.getElementById('back-to-main-menu-from-beast').addEventListener('click', () => {
            showScreen('mainMenu');
        });

        // Settings Screen Buttons
        document.getElementById('back-to-main-menu-from-settings').addEventListener('click', () => {
            showScreen('mainMenu');
        });

        // About Screen Buttons
        document.getElementById('back-to-main-menu-from-about').addEventListener('click', () => {
            showScreen('mainMenu');
        });

        // Game Over Screen Buttons
        document.getElementById('retry-button').addEventListener('click', () => {
            // 不在此处重复申请全屏：全屏已在「开始冒险」首次点击时请求，
            // 用户主动退出全屏后不反复强制重进（保持已有状态即可）
            showScreen('gameplay');
            Game.start(); // Restart game logic here
            console.log(`Retry Game with Outfit: ${selectedOutfit}`);
        });

        document.getElementById('home-button').addEventListener('click', () => {
            showScreen('mainMenu');
            Game.stop(); // Stop game when returning to main menu
            console.log("Back to Main Menu from Game Over");
        });

        // CG Screen Buttons
        document.getElementById('back-to-main-menu-from-cg').addEventListener('click', () => {
            showScreen('mainMenu');
            Game.stop(); // Stop game if somehow coming from CG screen to main menu
            console.log("Back to Main Menu from CG");
        });

        // Outfit Selection Logic（点击已解锁皮肤即装备；锁定卡抖动提示，不改变装备）
        document.querySelectorAll('.outfit-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.outfit;
                // 点击的是整个皮肤系列：解锁后即装备，进游戏自动播放该系列 1→2→3 嘴型动画
                if (!Game.isSeriesUnlocked(id)) {
                    card.classList.remove('shake');
                    void card.offsetWidth; // 强制重排，连续点击也能重启动画
                    card.classList.add('shake');
                    console.log(`Outfit ${id} is locked.`);
                    return;
                }
                selectedOutfit = id;
                renderOutfitStates();
                console.log(`Outfit ${selectedOutfit} equipped.`);
            });
        });

        // Character Selection Logic
        document.querySelectorAll('.character-card').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('.character-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                selectedCharacter = card.dataset.character;
                console.log(`Character ${selectedCharacter} selected.`);
            });
        });

        // Level Selection：关卡卡片统一由 LEVEL_META 配置渲染（封面走图片资源，不写死在
        // HTML/代码里；新增关卡只需加一行）。封面加载成功 → 可玩；加载失败 → 「即将开放」锁定；
        // 点击可玩关卡直接开始游戏（背景由 Game.start 按 LEVELS 配置加载对应 levelX_bg.png）
        const LEVEL_META = [
            { level: 'level1', name: '薄荷甜品花园', cover: 'assets/level1_bg.png' },
            { level: 'level2', name: '糖晶极光', cover: 'assets/level2_bg.png' }
        ];
        const levelSelectionBox = document.querySelector('.level-selection');
        LEVEL_META.forEach(meta => {
            const card = document.createElement('div');
            card.className = 'level-card';
            card.dataset.level = meta.level;

            const cover = document.createElement('div');
            cover.className = 'level-cover level-cover-soon';
            const soon = document.createElement('span');
            soon.className = 'level-soon-text';
            soon.textContent = '即将开放';
            cover.appendChild(soon);

            const name = document.createElement('span');
            name.className = 'level-name';
            name.textContent = meta.name;

            card.appendChild(cover);
            card.appendChild(name);
            levelSelectionBox.appendChild(card);

            const coverImg = new Image();
            coverImg.alt = meta.name;
            coverImg.onload = () => {
                cover.classList.remove('level-cover-soon');
                cover.textContent = '';
                cover.appendChild(coverImg);
            };
            coverImg.onerror = () => card.classList.add('locked'); // 无封面图 = 未开放
            coverImg.src = meta.cover;

            card.addEventListener('click', () => {
                if (card.classList.contains('locked')) return; // 未开放关卡：忽略点击
                // 不在此处重复申请全屏：全屏已在「开始冒险」首次点击时请求，
                // 进入关卡只是沿用当前全屏状态（用户退出后不强制重进）
                selectedLevel = meta.level;
                showScreen('gameplay');
                Game.start(); // 开始关卡（携带当前装扮与所选关卡）
                console.log(`Level ${selectedLevel} selected, game starts.`);
            });
        });

        console.log("GameManager initialized. Current screen:", currentScreen ? currentScreen.id : "none");
    };

    return {
        init,
        showScreen,
        getSelectedOutfit: () => selectedOutfit,
        getSelectedCharacter: () => selectedCharacter,
        getSelectedLevel: () => selectedLevel,
        // 当前装备皮肤（角色衣柜 SKINS 的 id，默认 white=白糯米团）
        getSelectedSkin: () => (SKINS[selectedOutfit] ? selectedOutfit : DEFAULT_SKIN)
    };
})();

const Game = (() => {
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    let animationFrameId;
    let isRunning = false;
    let isPaused = false;       // 暂停状态：冻结玩家/障碍/甜品更新与生成
    let tutorialActive = false; // 新手引导浮层是否正在显示
    let score = 0;
    let lives = 3;
    // 本次运行统计（结算界面只读使用；不改变计分逻辑本身）
    let runDessertsCollected = 0;         // 本局收集甜品个数
    let discoveredAtRunStart = new Set(); // 开局时已发现甜品快照（结算时对比"新发现"）

    /* ============================================================
       素材替换接口：所有图片路径集中在这里管理。
       以后生成正式素材后，只需要把文件放进 assets 文件夹，
       并确认这里的文件名与实际文件一致即可，其余代码不用动。
       ============================================================ */
    const ASSETS = {
        // 主角形象（经典糯米团）：normal 正常态 = 基础图（兼作兜底图）
        character: 'assets/经典糯米团1.png',
        // 主角三态嘴型图（同为透明背景侧面 Sprite，绘制时统一缩放、同一锚点对齐；
        // 1=待机闭嘴 / 2=张嘴 / 3=笑脸，其余系列见顶部 SKINS 配置）
        characterStates: {
            normal: 'assets/经典糯米团1.png',  // 正常飞行/移动（不张嘴）
            eating: 'assets/经典糯米团2.png',  // 张嘴吃甜品（吃到甜品瞬间）
            happy: 'assets/经典糯米团3.png'    // 幸福闭眼满足（吃完短暂反馈）
        },
        // 玩家载具：甜品飞船（白色糯米团坐在其驾驶舱中，合成绘制见 drawPlayer）
        ship: 'assets/dessert_ship.png',
        // 大地兽伙伴（跟随玩家的小兽）
        partner: 'assets/placeholder_earthen_beast.png',
        // 服饰图层配置（那刻夏时期遗留，新角色不再绘制该叠层；
        // 保留路径作为未来美术素材替换接口）
        outfits: {
            '01': 'assets/placeholder_character.png',   // Outfit 01 标准深藏青外套 = 复用基础形象
            '02': 'assets/placeholder_outfit_02.png',   // Outfit 02 黑白女仆装 + 白色眼罩（图片待生成）
            '03': 'assets/placeholder_outfit_03.png'    // Outfit 03 大地兽连体帽衫（图片待生成）
        },
        // 三只野生大地兽（碰到即收集：蓝=加分 紫=护盾 绿=吸附甜品）
        beast: (color) => `assets/earthen_beast_${color}.png`,
        // 关卡背景图
        background: (file) => `assets/${file}`,
        // 甜品收集物与障碍物
        collectible: (name) => `assets/collectible_${name}.png`,
        obstacle: (name) => `assets/obstacle_${name}.png`,
        // PNG 障碍物（assets/obstacles/ 目录，配 manifest.json 自动扫描清单）
        obstaclePng: (name) => `assets/obstacles/${name}.png`,
        // 紫色布丁泡泡护盾（玻璃泡泡素材，原样绘制不改图；挡伤时播放碎裂粒子）
        shield: 'assets/紫色护盾.png'
    };

    // 主角三态表情预载图：{ normal: Image, eating: Image, happy: Image }
    const playerStateImages = {};
    // 皮肤三态图集 { skinId: {normal, eating, happy} }（1/2/3 嘴型帧）；
    // loadCharacterAssets 统一预载全部系列；drawPlayer 按当前装备系列取图集
    const skinStateImages = {};
    // 玩家载具（甜品飞船）预载图：与糯米团在 drawPlayer() 中合成绘制
    const shipImage = new Image();
    // 三色大地兽预载图：收集野生大地兽后，伙伴用对应颜色的图绘制
    let beastVariantImages = {};

    // 紫色布丁玻璃泡泡护盾（素材原样绘制）。onload 后扫描一次 alpha 主体 bbox，
    // 绘制时按 bbox 源裁剪去除素材四周的透明边距，让泡泡精确贴合护盾半径；
    // 扫描失败（如 file:// 打开时 canvas 受限）则置 null，绘制走整图比例兜底
    const shieldImage = new Image();
    let shieldBounds = null;
    shieldImage.onload = () => {
        try {
            const oc = document.createElement('canvas');
            oc.width = shieldImage.naturalWidth;
            oc.height = shieldImage.naturalHeight;
            const octx = oc.getContext('2d');
            octx.drawImage(shieldImage, 0, 0);
            const data = octx.getImageData(0, 0, oc.width, oc.height).data;
            let L = oc.width, T = oc.height, R = 0, B = 0, found = false;
            for (let y = 0; y < oc.height; y += 2) {
                for (let x = 0; x < oc.width; x += 2) {
                    if (data[(y * oc.width + x) * 4 + 3] > 12) {
                        found = true;
                        if (x < L) L = x;
                        if (x > R) R = x;
                        if (y < T) T = y;
                        if (y > B) B = y;
                    }
                }
            }
            if (found) shieldBounds = { sx: L, sy: T, sw: R - L + 2, sh: B - T + 2 };
        } catch (e) {
            shieldBounds = null; // 像素读取受限：整图兜底，不影响游戏
        }
    };
    shieldImage.src = ASSETS.shield;

    // 判断一张图片是否"真正加载成功"。
    // 注意：空文件（0字节）或损坏图片在浏览器里 complete 也是 true，
    // 但 naturalWidth 为 0，所以必须同时检查 naturalWidth，
    // 这样未生成的图片会自动走色块占位，游戏不会报错白屏。
    const imgReady = (img) => img && img.complete && img.naturalWidth > 0;

    // Player character properties（白色糯米团）
    const player = {
        x: 50,
        y: 0, // Will be set in init
        width: 40,
        height: 40,
        speed: 5 * MOBILE_DIFF.moveSpeed, // 手机端 5×0.825=4.125（真机回调后）；PC 保持 5 不变
        dx: 0,
        dy: 0,
        color: '#ff8a65', // Default color, will be replaced by actual character/outfit
        isShielded: false,
        shieldEndTime: 0,
        shieldCharges: 0, // 紫色玩偶护盾：可抵挡一次伤害（消耗品）
        isAutoCollecting: false,
        autoCollectEndTime: 0,
        isDashing: false,
        dashEndTime: 0,
        facing: 'right', // 朝向：伙伴跟在朝向反侧的身后（白色糯米团是唯一玩家）
        stormEnergy: 0, // 甜品风暴能量：收集甜品积累，充满后可释放（唯一主动技能）
        popUntil: 0, // 收集反馈动画截止时间：吃到甜品后 0.3 秒内轻微 Pop+小跳
        hitFlashUntil: 0, // 受击反馈截止时间：撞到障碍物后 0.9 秒内闪烁（drawPlayer 消费）
        // 角色图片：image = normal 正常态基础图（兜底）；
        // faceState 为三态表情（normal/eating/happy），吃到甜品时短暂切换，
        // faceStateUntil 为当前表情的切换截止时间（Date.now() 时钟）
        image: new Image(),
        faceState: 'normal',
        faceStateUntil: 0,
        currentOutfit: null,
        // 碰撞检测：update() 里甜品/障碍/大地兽的碰撞都调用它。
        // 【重要修复】之前 player 上没有这个方法，游戏开始约 1.5 秒后
        // 第一颗甜品出现时会抛 TypeError 导致游戏循环卡死——
        // 表现就是"飞船是静态的、不能动"。
        collidesWith(other, pad = 0, otherScale = 1) {
            // 玩家=飞船+糯米团合成体：碰撞箱覆盖飞船碟身主体区域
            //（宽 40 保持视觉中心对称；高 36 对应放大后的碟身底部），
            // 透明背景区不产生碰撞
            // pad（手机端收集容错）：对方判定框四边外扩 pad px，视觉不变；
            // otherScale（手机端障碍容错）：对方碰撞框边长缩放，中心对齐内缩
            const hitH = 36;
            const ow = other.width * otherScale;
            const oh = other.height * otherScale;
            const ox = other.x + (other.width - ow) / 2;
            const oy = other.y + (other.height - oh) / 2;
            return this.x < ox + ow + pad &&
                   this.x + this.width > ox - pad &&
                   this.y < oy + oh + pad &&
                   this.y + hitH > oy - pad;
        }
    };

    // Earthen Beast partner —— 独立伙伴对象（永远不是玩家，也不进角色选择）
    // variant: null = 无颜色能力（守护技能召唤时的默认形象）
    //          'blue' / 'purple' / 'green' = 收集野生大地兽后获得的跟随能力
    const earthenBeastPartner = {
        x: player.x - 50, // Position relative to player
        y: player.y,
        width: 30,
        height: 30,
        color: '#64b5f6', // Default blue（激活颜色能力后会被替换为对应颜色）
        image: new Image(),
        isVisible: false, // Only visible when in use or summoned
        variant: null,    // 当前跟随的颜色能力，见 EARTHEN_BEAST_TYPES
        endTime: 0,       // 陪伴截止时间戳（激活时 +5 秒；到期自动离场）
        shieldUntil: 0,   // 紫色专属：护盾截止时间戳（激活时 +7 秒；跟随结束后护盾独立续航）
        alpha: 1          // 绘制透明度：离场前最后 0.8 秒平滑淡出
    };

    // 加载角色与伙伴图片，并预载主角三态表情图与甜品飞船图
    const loadCharacterAssets = () => {
        player.image.src = ASSETS.character;
        player.image.onload = () => console.log("Character image loaded.");
        earthenBeastPartner.image.src = ASSETS.partner;
        earthenBeastPartner.image.onload = () => console.log("Earthen Beast image loaded.");
        // 预载三色野生大地兽图（收集后作为伙伴形象复用同一套图，三色同模板）
        beastVariantImages = {};
        EARTHEN_BEAST_TYPES.forEach((t) => {
            const img = new Image();
            img.src = ASSETS.beast(t.name);
            beastVariantImages[t.name] = img;
        });
        // 预载主角三态嘴型图（经典系列 = playerStateImages，兼作素材缺失时的兜底图集）
        Object.entries(ASSETS.characterStates).forEach(([key, src]) => {
            const img = new Image();
            img.src = src;
            playerStateImages[key] = img;
        });
        // 预载全部皮肤系列的三帧嘴型图（1=normal / 2=eating / 3=happy）；
        // 换肤零等待：进游戏前所有系列图已就绪，仅切换绘制源
        Object.entries(SKINS).forEach(([skinId, s]) => {
            const set = {};
            Object.entries(s.states).forEach(([key, src]) => {
                const img = new Image();
                img.src = src;
                set[key] = img;
            });
            skinStateImages[skinId] = set;
        });
        // 预载甜品飞船图（玩家载具，与糯米团合成绘制）
        shipImage.src = ASSETS.ship;
    };

    const LEVELS = {
        level1: {
            winScore: 5000,
            collectibleSpawnRate: 1500,
            obstacleSpawnRate: 2000,
            earthenBeastSpawnRate: 5000,
            background: 'level1_bg.png' // Placeholder background image
        },
        level2: {
            winScore: 10000,
            collectibleSpawnRate: 1200,
            obstacleSpawnRate: 1800,
            earthenBeastSpawnRate: 4000,
            background: 'level2_bg.png' // Placeholder background image
        }
        // Add more levels as needed
    };

    let currentLevel = LEVELS.level1; // Default level

    // ============================================================
    // 动态难度 / 动态掉落 / 收藏目标 配置常量
    // ============================================================
    // 每关难度分档：score 达到 min 即进入该档（取最后一个满足的档）。
    // speedMul=障碍速度倍率；densityMul=生成频率倍率；cloudAgilityMul=风暴云垂直灵敏度；
    // iceBias=冰晶出现权重增量（正数=冰晶略增）。数值来自策划表，调整只改这里。
    const DIFFICULTY_TIERS_BY_LEVEL = {
        level1: [ // 第一关｜薄荷甜品花园：由轻松逐渐进入挑战
            { min: 0,    name: 'Lv1', speedMul: 1.00, densityMul: 1.00, cloudAgilityMul: 1.00, iceBias: 0 },
            { min: 300,  name: 'Lv2', speedMul: 1.08, densityMul: 1.08, cloudAgilityMul: 1.00, iceBias: 0 },
            { min: 700,  name: 'Lv3', speedMul: 1.15, densityMul: 1.15, cloudAgilityMul: 1.15, iceBias: 0 },
            { min: 1200, name: 'Lv4', speedMul: 1.22, densityMul: 1.20, cloudAgilityMul: 1.15, iceBias: 5 }
        ],
        level2: [ // 第二关｜糖晶极光：机制相同，整体起点更高（0 分 ≈ 第一关 300 分后）
            { min: 0,    name: 'Lv2', speedMul: 1.08, densityMul: 1.08, cloudAgilityMul: 1.15, iceBias: 0 },
            { min: 300,  name: 'Lv3', speedMul: 1.18, densityMul: 1.18, cloudAgilityMul: 1.15, iceBias: 0 },
            { min: 700,  name: 'Lv4', speedMul: 1.26, densityMul: 1.25, cloudAgilityMul: 1.15, iceBias: 0 },
            { min: 1200, name: 'Lv5', speedMul: 1.35, densityMul: 1.32, cloudAgilityMul: 1.30, iceBias: 0 }
        ]
    };
    // 隐藏动态成长（玩家不可见，无任何 UI 提示）：连续平滑叠加在分档倍率之上，
    // 让游戏随积分自然变难、避免档位跳变感
    const HIDDEN_GROWTH = {
        speedPer100: 0.02,      // 每 100 分：障碍整体速度 +2%
        densityPer100: 0.015,   // 每 100 分：障碍生成频率 +1.5%
        cloudPer200: 0.03,      // 每 200 分：风暴云随机移动幅度 +3%
        iceSpeedMaxBonus: 0.25  // 漂浮冰晶速度成长上限：不超过基础值 +25%
    };
    // 动态掉落概率（按本局积分分档，单位 %；每局重算，不继承上一局）
    const DROP_TIERS = [
        { min: 0,    common: 99.7, rare: 0.29, legendary: 0.01 },
        { min: 300,  common: 98.3, rare: 1.5,  legendary: 0.2 },
        { min: 700,  common: 95,   rare: 4.2,  legendary: 0.8 },
        { min: 1200, common: 91,   rare: 8,    legendary: 1 }
    ];
    // 掉落硬约束（规则优先于概率，不满足时回落为普通）
    const DROP_RULES = {
        legendaryMaxPerRun: 1,   // 星糖（传说）每局最多出现 1 次
        legendaryGapCommons: 25, // 两个传说之间至少间隔 25 个普通甜品
        rareMaxStreak: 2         // 稀有最多连续出现 2 个
    };
    // 图鉴收藏目标：所有甜品统一目标数量
    const COLLECT_GOAL = 20;

    // ============================================================
    // 动态难度系统（运行时状态与计算）：
    // 按本局积分实时计算各倍率；倍率只作用于"新生成的障碍"——场上已有
    // 障碍保持原速，新障碍逐个应用新倍率 → 天然平滑过渡，不会突然暴涨；
    // 隐藏成长每 100/200 分微调一次，无任何"难度提升"类提示。
    // ============================================================
    const difficulty = {
        tierName: 'Lv1',
        tierSpeedMul: 1,       // 分档速度倍率
        hiddenSpeedBonus: 0,   // 隐藏成长速度加成（连续）
        densityMul: 1,         // 综合（分档×隐藏）密度倍率
        cloudAgilityMul: 1,    // 风暴云垂直灵敏度倍率
        iceBias: 0,            // 冰晶权重增量
        lastSpawnMs: 0         // 当前生效的障碍生成间隔（变更检测用）
    };
    const recomputeDifficulty = () => {
        const levelKey = GameManager.getSelectedLevel() || 'level1';
        const tiers = DIFFICULTY_TIERS_BY_LEVEL[levelKey] || DIFFICULTY_TIERS_BY_LEVEL.level1;
        let tier = tiers[0];
        for (const t of tiers) if (score >= t.min) tier = t;
        const speedBonus = Math.floor(score / 100) * HIDDEN_GROWTH.speedPer100;
        const densityBonus = Math.floor(score / 100) * HIDDEN_GROWTH.densityPer100;
        const cloudBonus = Math.floor(score / 200) * HIDDEN_GROWTH.cloudPer200;
        difficulty.tierName = tier.name;
        difficulty.tierSpeedMul = tier.speedMul;
        difficulty.hiddenSpeedBonus = speedBonus;
        difficulty.densityMul = tier.densityMul * (1 + densityBonus);
        difficulty.cloudAgilityMul = tier.cloudAgilityMul * (1 + cloudBonus);
        difficulty.iceBias = tier.iceBias;
    };
    // 指定障碍类型的水平速度倍率：冰晶封顶 +25%，其余障碍完整成长
    const getObstacleSpeedMul = (type) => {
        const bonus = type && type.name === 'ice_crystal'
            ? Math.min(difficulty.hiddenSpeedBonus, HIDDEN_GROWTH.iceSpeedMaxBonus)
            : difficulty.hiddenSpeedBonus;
        return difficulty.tierSpeedMul * (1 + bonus);
    };
    // 障碍生成间隔（密度）：基础间隔 / 密度倍率，下限 400ms 防极端密集
    const getObstacleSpawnMs = () =>
        Math.max(400, Math.round(currentLevel.obstacleSpawnRate / difficulty.densityMul));
    // 密度变化（跨 100 分步进）时平滑重建障碍生成定时器；
    // 风暴/暂停/未运行期间不重建（对应路径本就不生成障碍或退出时会重算）
    const refreshObstacleSpawnRate = () => {
        if (stormState.active || !isRunning || isPaused) return;
        const ms = getObstacleSpawnMs();
        if (ms === difficulty.lastSpawnMs) return;
        difficulty.lastSpawnMs = ms;
        clearInterval(obstacleSpawnInterval);
        obstacleSpawnInterval = setInterval(spawnObstacle, ms);
    };

    // ============================================================
    // 动态掉落系统：按本局积分取概率分档 + 硬约束（星糖限 1 / 传说间隔 /
    // 稀有连击上限）。只依赖本局积分，与图鉴解锁状态完全无关。
    // ============================================================
    const dropState = {
        legendarySpawned: 0,
        commonsSinceLegendary: DROP_RULES.legendaryGapCommons, // 无历史 → 视为已满足间隔
        rareStreak: 0
    };
    const resetDropState = () => {
        dropState.legendarySpawned = 0;
        dropState.commonsSinceLegendary = DROP_RULES.legendaryGapCommons;
        dropState.rareStreak = 0;
    };
    // 抽取本颗甜品稀有度：先按积分档概率抽取，再过硬约束（不满足回落普通）
    const rollDropTier = () => {
        let tier = DROP_TIERS[0];
        for (const t of DROP_TIERS) if (score >= t.min) tier = t;
        const roll = Math.random() * 100;
        let picked = 'common';
        if (roll < tier.legendary) picked = 'legendary';
        else if (roll < tier.legendary + tier.rare) picked = 'rare';
        if (picked === 'legendary' &&
            (dropState.legendarySpawned >= DROP_RULES.legendaryMaxPerRun ||
             dropState.commonsSinceLegendary < DROP_RULES.legendaryGapCommons)) {
            picked = 'common';
        }
        if (picked === 'rare' && dropState.rareStreak >= DROP_RULES.rareMaxStreak) {
            picked = 'common';
        }
        // 状态推进（按生成结果计数）
        if (picked === 'legendary') {
            dropState.legendarySpawned++;
            dropState.commonsSinceLegendary = 0;
            dropState.rareStreak = 0;
        } else if (picked === 'rare') {
            dropState.rareStreak++;
        } else {
            dropState.commonsSinceLegendary++;
            dropState.rareStreak = 0;
        }
        return picked;
    };

    // Get score and lives display elements
    const scoreDisplay = document.getElementById('score');
    const livesDisplay = document.getElementById('lives');

    const collectibles = [];
    const collectFx = []; // 收集动画层：甜品被吃掉后在原位轻微放大 + 淡出
    const obstacles = [];
    const earthenBeasts = []; // Wild earthen beasts to collect
    let collectibleSpawnInterval;
    let stormSpawnInterval; // 风暴期间的高频甜品涌出定时器
    // 甜品风暴状态：active 期间障碍停生、甜品雨、梦幻滤镜（持续 5 秒）
    const stormState = { active: false, timeLeft: 0 };
    let lastFrameTime = 0; // 帧间时间基准（风暴倒计时用；暂停时 update 不跑，倒计时自动冻结）
    let obstacleSpawnInterval;
    let earthenBeastSpawnInterval;

    // Red Clay collection system
    const redClayCount = 0; // To track collected Red Clay

    const COLLECTIBLE_TYPES = [
        // 普通 common ×10（用户上传素材：三色马卡龙 / 三色小蛋糕 / 糖果 / 布丁 / 双色甜甜圈）
        { name: 'macaron_mint', color: '#a8e6cf', points: 10 },   // 马卡龙（薄荷绿）
        { name: 'macaron_pink', color: '#f8a5c2', points: 10 },   // 马卡龙（粉色）
        { name: 'macaron_purple', color: '#c39bd3', points: 10 }, // 马卡龙（紫色）
        { name: 'cupcake_mint', color: '#a8e6cf', points: 10 },   // 小蛋糕（薄荷绿）
        { name: 'cupcake_pink', color: '#f8a5c2', points: 10 },   // 小蛋糕（粉色）
        { name: 'cupcake_purple', color: '#c39bd3', points: 10 }, // 小蛋糕（紫色）
        { name: 'candy', color: '#ff70a6', points: 10 },          // 糖果
        { name: 'pudding', color: '#ffe4b5', points: 10 },        // 布丁
        { name: 'donut_mint', color: '#a8e6cf', points: 10 },     // 甜甜圈（薄荷绿）
        { name: 'donut_pink', color: '#f8a5c2', points: 10 },     // 甜甜圈（粉色）
        // 稀有 rare ×2
        { name: 'mint_soda', color: '#7fd8be', points: 30 },      // 薄荷气泡水
        { name: 'strawberry_cake', color: '#ff69b4', points: 30 },// 草莓蛋糕
        // 传说 legendary ×1
        { name: 'red_clay', color: '#ffd54f', points: 100 }       // 星糖（内部 key 保留 red_clay）
    ];

    // 甜品图鉴数据（只做数据逻辑，UI 图鉴界面后续再做）
    // 每种甜品：id / 名称 / 是否发现 / 收藏数量 / 稀有度(common| rare | legendary) / 简单介绍
    // discovered 是跨局进度：重开局不清空，本局内记录在内存中
    // count = 收藏数量（发现+收藏双系统，目标 COLLECT_GOAL），随存档持久化
    const DESSERT_DEX = {
        macaron_mint: { id: 'macaron_mint', name: '马卡龙（薄荷绿）', discovered: false, count: 0, rarity: 'common', desc: '薄荷绿的清新马卡龙，外壳酥脆、内里绵软。' },
        macaron_pink: { id: 'macaron_pink', name: '马卡龙（粉色）', discovered: false, count: 0, rarity: 'common', desc: '粉嫩嫩的草莓味马卡龙，甜蜜值满分。' },
        macaron_purple: { id: 'macaron_purple', name: '马卡龙（紫色）', discovered: false, count: 0, rarity: 'common', desc: '紫色外壳藏着薄荷夹心，香气神秘。' },
        cupcake_mint: { id: 'cupcake_mint', name: '小蛋糕（薄荷绿）', discovered: false, count: 0, rarity: 'common', desc: '顶着奶油花和彩糖粒的薄荷绿纸杯蛋糕。' },
        cupcake_pink: { id: 'cupcake_pink', name: '小蛋糕（粉色）', discovered: false, count: 0, rarity: 'common', desc: '粉色糖霜配彩糖粒，甜度刚好。' },
        cupcake_purple: { id: 'cupcake_purple', name: '小蛋糕（紫色）', discovered: false, count: 0, rarity: 'common', desc: '梦幻紫色的小纸杯蛋糕，奶油花头。' },
        candy: { id: 'candy', name: '糖果', discovered: false, count: 0, rarity: 'common', desc: '透明糖纸包着的薄荷糖，拆开有惊喜。' },
        pudding: { id: 'pudding', name: '布丁', discovered: false, count: 0, rarity: 'common', desc: '焦糖布丁，轻轻一碰就会颤动。' },
        donut_mint: { id: 'donut_mint', name: '甜甜圈（薄荷绿）', discovered: false, count: 0, rarity: 'common', desc: '薄荷绿糖霜的圆环甜甜圈，撒着糖珠。' },
        donut_pink: { id: 'donut_pink', name: '甜甜圈（粉色）', discovered: false, count: 0, rarity: 'common', desc: '粉色糖霜配彩色糖粒的经典甜甜圈。' },
        mint_soda: { id: 'mint_soda', name: '薄荷气泡水', discovered: false, count: 0, rarity: 'rare', desc: '冒着气泡的薄荷汽水，冰凉解腻。' },
        strawberry_cake: { id: 'strawberry_cake', name: '草莓蛋糕', discovered: false, count: 0, rarity: 'rare', desc: '鲜奶油草莓蛋糕，甜品日的明星。' },
        red_clay: { id: 'red_clay', name: '星糖', discovered: false, count: 0, rarity: 'legendary', desc: '传说中的星糖，闪烁着星光。似乎蕴含着特别的力量（后续功能预留）。' }
    };

    // 甜品稀有度（历史兜底常量）：动态掉落上线后 spawnCollectible 改用 DROP_TIERS
    // 按本局积分取概率；本常量保留仅供测试钩子读取对照。
    // 分组依据 DESSERT_DEX 的 rarity 字段自动归类，新增甜品时无需改这里
    const RARITY_WEIGHTS = { common: 90, rare: 9, legendary: 1 };
    // 收集物显示/碰撞缩放（基于 64×64 基准框；素材为正方形 PNG → 等比缩放不拉伸）：
    // 普通 55% / 稀有 62% / 传说 68%。玩家尺寸不受影响。
    const COLLECTIBLE_SCALE_BY_TIER = { common: 0.55, rare: 0.62, legendary: 0.68 };
    const COLLECTIBLE_BASE_SIZE = 64;
    const COLLECTIBLE_RARITY_POOL = (() => {
        const pool = { common: [], rare: [], legendary: [] };
        COLLECTIBLE_TYPES.forEach((t) => {
            const dex = DESSERT_DEX[t.name];
            (pool[dex ? dex.rarity : 'common'] || pool.common).push(t);
        });
        return pool;
    })();

    // 记录图鉴发现与收藏：首次收集置 discovered=true；此后每次收集 count+1。
    // 发现状态与收藏数量都随本地存档持久化；解锁状态不影响掉落概率。
    const discoverDessert = (id) => {
        const entry = DESSERT_DEX[id];
        if (entry) {
            entry.count = (entry.count || 0) + 1;
            saveProfile(); // 图鉴数据变更 → 自动保存（内部防抖合并写入）
            checkSkinUnlocks(); // 皮肤系列解锁检查（薄荷气泡水/星糖累计达标 → 自动解锁）
            if (!entry.discovered) {
                entry.discovered = true;
                console.log(`图鉴发现: ${entry.name} (${entry.id})`);
                // 首次发现稀有/特殊甜品：图鉴新发现提示（每种仅提示一次，不刷屏）
                if (entry.rarity === 'rare' || entry.rarity === 'legendary') {
                    showNewDiscoveryToast(entry);
                }
                return true;
            }
        }
        return false;
    };

    // ============================================================
    // 成就数据框架（仅数据 + 判定，不做 UI；后续成就页面直接读取）
    // 判定全部从已有数据派生：图鉴发现数 / 星糖发现状态 / 当前得分，
    // completed 持久化到 localStorage，跨局保留。
    // ============================================================
    const ACHIEVEMENTS = [
        { id: 'first_collect', name: '初次品尝', description: '首次收集甜品', completed: false },
        { id: 'collect_five_types', name: '甜品探险家', description: '收集5种不同甜品', completed: false },
        { id: 'high_score', name: '高分飞行日', description: '单局得分达到 500', completed: false },
        { id: 'find_red_clay', name: '摘星时刻', description: '找到传说甜品星糖', completed: false }
    ];
    const ACHIEVEMENTS_KEY = 'nacrez_achievements';
    const loadAchievements = () => {
        try {
            const saved = JSON.parse(localStorage.getItem(ACHIEVEMENTS_KEY));
            if (Array.isArray(saved)) {
                ACHIEVEMENTS.forEach((a) => { if (saved.includes(a.id)) a.completed = true; });
            }
        } catch (e) { /* localStorage 不可用时用默认值 */ }
    };
    const saveAchievements = () => {
        try {
            const done = ACHIEVEMENTS.filter((a) => a.completed).map((a) => a.id);
            localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(done));
        } catch (e) { /* 忽略 */ }
    };
    // 成就判定：在甜品发现 / 结算等事件后调用，只读当前数据，不改变玩法逻辑
    const checkAchievements = () => {
        const dexCount = Object.values(DESSERT_DEX).filter((e) => e.discovered).length;
        let changed = false;
        const mark = (id, cond) => {
            const a = ACHIEVEMENTS.find((x) => x.id === id);
            if (a && !a.completed && cond) {
                a.completed = true;
                changed = true;
                console.log(`成就达成: ${a.name} — ${a.description}`);
            }
        };
        mark('first_collect', dexCount >= 1);
        mark('collect_five_types', dexCount >= 5);
        mark('find_red_clay', !!(DESSERT_DEX.red_clay && DESSERT_DEX.red_clay.discovered));
        mark('high_score', score >= 500);
        if (changed) saveAchievements();
    };

    // 最高分记录（localStorage 持久化，结算界面只读展示）
    const HIGH_SCORE_KEY = 'nacrez_high_score';
    const getHighScore = () => {
        try { return parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10) || 0; }
        catch (e) { return 0; }
    };
    const saveHighScore = (v) => {
        try { localStorage.setItem(HIGH_SCORE_KEY, String(v)); } catch (e) { /* 忽略 */ }
    };

    // 新手引导：只显示一次（localStorage 记录是否看过教程）
    const TUTORIAL_KEY = 'nacrez_tutorial_seen';
    const tutorialSeen = () => {
        try { return localStorage.getItem(TUTORIAL_KEY) === '1'; }
        catch (e) { return false; }
    };

    // PNG 障碍物（assets/obstacles/）：三种素材 + 各自动画配置
    // 统一尺寸 64×64（素材 256² 画布等比缩放不拉伸），碰撞体固定不变
    // anim: 'sheet' 三帧循环（风暴云）/ 'float' Y轴漂浮（冰晶）/ 'breath' 呼吸缩放（泡泡）
    // weight = 出现权重（后期调概率直接改数字即可）
    const OBSTACLE_SIZE = 64;
    // 智能游走风暴云同屏上限（避免难度过高）
    const WANDER_MAX_ONSCREEN = 2;
    const OBSTACLE_PRESETS = {
        storm_cloud_sheet: {
            title: '糖果风暴云', color: '#b39ddb', anim: 'sheet',
            frames: 3, frameMs: 120,           // 1→2→3→1 循环，每帧约 120ms（≈8 FPS）
            // 智能游走（Wandering）：恒向左推进 + 垂直速度周期性随机变化，轨迹不可预测
            wander: {
                baseSpeed: 2.2,   // 平均向左推进速度（px/帧）
                vyMax: 1.6,       // 垂直速度上限（px/帧）
                turnMinMs: 800,   // 每 0.8~1.5 秒随机换一次目标方向
                turnMaxMs: 1500,
                steer: 0.04       // 逐帧朝目标速度平滑逼近的系数（转向圆滑，不产生折线）
            },
            weight: 40
        },
        ice_crystal: {
            title: '漂浮冰晶', color: '#90caf9', anim: 'float',
            floatAmp: 4, floatMs: 2400,        // 不旋转，仅 Y 轴 ±4px 缓慢漂浮
            alpha: 0.9,                        // 轻微半透明冰雾感
            weight: 35
        },
        candy_bubble: {
            title: '糖果泡泡', color: '#a5d6a7', anim: 'breath',
            breathAmp: 0.05, breathMs: 1200,   // 缩放 95%~105%，约 1.2 秒循环
            alpha: 0.88,                       // 半透明彩色泡泡
            weight: 25
        }
    };
    // 未知素材的兜底配置：自动扫描进来的新 PNG 默认按漂浮障碍处理
    const OBSTACLE_DEFAULT = { title: '', color: '#b0bec5', anim: 'float', floatAmp: 4, floatMs: 2400, alpha: 0.9, weight: 30 };
    // manifest 加载失败（如 file:// 直开）时的兜底清单
    const OBSTACLE_FALLBACK_NAMES = ['storm_cloud_sheet', 'ice_crystal', 'candy_bubble'];
    // 自动扫描 assets/obstacles/manifest.json 构建障碍物类型表；
    // 新增 PNG 只需重跑清单生成，无需改这里
    let OBSTACLE_TYPES = null; // 就绪前 spawnObstacle 跳过
    const buildObstacleTypes = (names) => {
        OBSTACLE_TYPES = names.map((n) => Object.assign({ name: n }, OBSTACLE_DEFAULT, OBSTACLE_PRESETS[n] || {}));
    };
    (loadObstacleManifest)();
    function loadObstacleManifest() {
        buildObstacleTypes(OBSTACLE_FALLBACK_NAMES); // 先兜底，游戏即刻可玩
        fetch('assets/obstacles/manifest.json')
            .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
            .then((list) => Array.isArray(list) && list.length && buildObstacleTypes(list))
            .catch(() => {}); // 已有兜底清单，静默
    }

    // 三只甜品陪伴玩偶（碰到即收集：蓝=加分 紫=护盾 绿=吸附甜品）
    // name = 内部 key（颜色能力标识，保留原名避免大重构）；title = 玩家可见名称
    // count = 玩偶收藏数量（每次收集 +1，随存档持久化）
    const EARTHEN_BEAST_TYPES = [
        { name: 'blue', title: '蓝莓布丁团', color: '#64b5f6', effect: 'score_bonus', bonus: 100, count: 0 },
        { name: 'purple', title: '芋泥麻薯团', color: '#ba68c8', effect: 'shield', count: 0 }, // 芋泥紫：获得护盾，抵挡一次伤害
        { name: 'green', title: '抹茶布丁团', color: '#81c784', effect: 'auto_collect', count: 0 }
    ];

    // ============================================================
    // 本地记忆系统（localStorage 自动保存/恢复）
    // 保存：图鉴发现+每种甜品收藏数量 / 每种甜品玩偶收藏数量 / 已解锁关卡。
    // 最高分与玩家设置沿用既有 HIGH_SCORE_KEY / SETTINGS_KEY 机制（同样自动恢复）。
    // 不保存：本局积分、关卡进行中状态（两者均不落盘，重开网页即弃）。
    // ============================================================
    const SAVE_KEY = 'nacrez_save_v1';
    // 已解锁关卡：当前两关均开放（与现有行为一致）；将来做解锁进度时直接改这里
    const DEFAULT_UNLOCKED_LEVELS = ['level1', 'level2'];
    let saveDebounceTimer = 0;
    // 皮肤系列解锁：显式标记随存档持久化；同时可从图鉴累计数实时推导（两者取或，
    // 即使存档字段缺失也能按收集进度自动恢复解锁）。经典糯米团默认解锁；
    // 沁凉薄荷 = 累计薄荷气泡水、幻彩星糖 = 累计星糖，达 SKIN_UNLOCK_GOAL 解锁整系列。
    const skinSave = { unlocked: {} };
    const isSeriesUnlocked = (id) => {
        const s = SKINS[id];
        if (!s) return false;
        if (!s.unlockDessert) return true;
        if (skinSave.unlocked[id]) return true;
        const entry = DESSERT_DEX[s.unlockDessert];
        return !!entry && (entry.count || 0) >= SKIN_UNLOCK_GOAL;
    };
    // 衣橱进度展示：{ name: 甜品名, count: 累计收集数, goal: 解锁目标 }
    const getSkinProgress = (id) => {
        const s = SKINS[id];
        const entry = s && s.unlockDessert ? DESSERT_DEX[s.unlockDessert] : null;
        return {
            name: entry ? entry.name : '',
            count: entry ? (entry.count || 0) : 0,
            goal: SKIN_UNLOCK_GOAL
        };
    };
    // 每次收集甜品后检查：达标系列自动解锁（写档 + 游戏内 toast 提示）
    const checkSkinUnlocks = () => {
        Object.entries(SKINS).forEach(([id, s]) => {
            if (!s.unlockDessert || skinSave.unlocked[id]) return;
            const entry = DESSERT_DEX[s.unlockDessert];
            if (entry && (entry.count || 0) >= SKIN_UNLOCK_GOAL) {
                skinSave.unlocked[id] = true;
                saveProfile(); // 解锁状态写入存档（防抖合并写入）
                showGameToast('skin-unlock-toast', `皮肤系列解锁：${s.name}！`, 2800);
                console.log(`Skin series unlocked: ${id}`);
            }
        });
    };

    const saveProfile = () => {
        // 500ms 防抖合并写入：连续收集甜品时避免频繁 localStorage IO
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = setTimeout(() => {
            try {
                const dex = {};
                Object.values(DESSERT_DEX).forEach((e) => {
                    dex[e.id] = { d: e.discovered ? 1 : 0, c: e.count || 0 };
                });
                const beasts = {};
                EARTHEN_BEAST_TYPES.forEach((b) => { beasts[b.name] = b.count || 0; });
                localStorage.setItem(SAVE_KEY, JSON.stringify({
                    dex,
                    beasts,
                    skins: { ...skinSave.unlocked }, // 皮肤系列解锁状态随存档持久化
                    unlockedLevels: DEFAULT_UNLOCKED_LEVELS
                }));
            } catch (e) { /* 存储不可用（隐私模式等）：静默跳过，游戏照常 */ }
        }, 500);
    };
    const loadProfile = () => {
        try {
            const raw = JSON.parse(localStorage.getItem(SAVE_KEY));
            if (!raw) return;
            if (raw.dex) {
                Object.values(DESSERT_DEX).forEach((e) => {
                    const s = raw.dex[e.id];
                    if (s) { e.discovered = !!s.d; e.count = s.c || 0; }
                });
            }
            if (raw.beasts) {
                EARTHEN_BEAST_TYPES.forEach((b) => { b.count = raw.beasts[b.name] || 0; });
            }
            if (raw.skins) {
                // 只恢复已知的皮肤系列键，防止脏数据混入
                Object.keys(SKINS).forEach((id) => {
                    if (raw.skins[id]) skinSave.unlocked[id] = true;
                });
            }
        } catch (e) { /* 数据损坏：保持初始状态 */ }
    };
    loadProfile(); // 玩家重新打开网页时自动恢复图鉴/收藏/玩偶进度

    // 甜品风暴：游戏内唯一主动技能（守护兽技能已移除，大地兽只作为伙伴陪伴冒险）
    // 风暴值通过收集甜品积累，充满后按钮进入可释放状态（替代旧的冷却制）
    const SKILLS = {
        dessertStorm: { // Q / Space / 底部甜品风暴按钮
            energyMax: 100,   // 风暴值上限（%）
            durationMs: 5000  // 释放后持续 5 秒的"薄荷甜品魔法时间"
        }
    };
    // 每颗甜品回复的风暴值（%）：普通 +5，稀有/特殊有加成（出现少，回报略高）
    const STORM_ENERGY_BY_RARITY = { common: 5, rare: 10, legendary: 20 };
    const STORM_DESSERT_SPAWN_MS = 300; // 风暴期间甜品涌出间隔（大量甜品出现）

    // 甜品玩偶伙伴单次陪伴时长上限：5 秒，到期自动平滑离场（伙伴定位不变，
    // 只是单次陪伴有上限，让玩家对玩偶的到来与告别都有预期）
    const PARTNER_MAX_MS = 5000;
    // 紫色布丁专属：跟随 5 秒结束后，泡泡护盾再独立保留 2 秒（即自激活起第 7 秒到期）
    const SHIELD_EXTEND_MS = 2000;

    // 轻量粒子：只做简单反馈（蓝=金色星星 / 紫=泡泡破裂 / 绿=绿色光点），无复杂特效
    const particles = [];
    const spawnParticles = (x, y, kind) => {
        for (let i = 0; i < 8; i++) {
            const a = (Math.PI * 2 * i) / 8 + Math.random() * 0.5;
            const sp = 1.2 + Math.random() * 1.6;
            particles.push({
                x, y,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                life: 1,
                decay: 0.03 + Math.random() * 0.02,
                size: 2 + Math.random() * 2,
                kind
            });
        }
    };
    // 玻璃泡泡碎裂粒子（紫色护盾挡伤专用）：白色/淡紫玻璃碎片（旋转小三角片）+
    // 淡紫描边小泡泡圈上飘，营造"泡泡被戳破"的轻柔碎裂感
    const spawnShieldBreak = (x, y) => {
        for (let i = 0; i < 14; i++) {
            const a = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
            const sp = 1.6 + Math.random() * 2.2;
            particles.push({
                x, y,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                life: 1,
                decay: 0.026 + Math.random() * 0.02,
                size: 2.5 + Math.random() * 3,
                kind: 'shard',
                rot: Math.random() * Math.PI,
                vrot: (Math.random() - 0.5) * 0.3,
                color: Math.random() < 0.5 ? 'rgba(255,255,255,0.95)' : 'rgba(225,190,231,0.95)'
            });
        }
        for (let i = 0; i < 6; i++) {
            const a = Math.random() * Math.PI * 2;
            particles.push({
                x, y,
                vx: Math.cos(a) * 0.8, vy: Math.sin(a) * 0.8 - 0.7,
                life: 1,
                decay: 0.02 + Math.random() * 0.015,
                size: 2.5 + Math.random() * 3.5,
                kind: 'bubble'
            });
        }
    };

    // 粒子总量上限：触摸设备更保守（防风暴等高峰期低端手机掉帧），桌面维持原有观感
    const MAX_PARTICLES = IS_TOUCH ? 160 : 260;
    // 受击轻晃：给游戏容器加 0.3s 摇晃类，动画结束后自动移除（重触发先重置）
    const triggerHitShake = () => {
        const c = document.getElementById('game-container');
        if (!c) return;
        c.classList.remove('hit-shake');
        void c.offsetWidth; // 强制回流，让连续受击也能重播动画
        c.classList.add('hit-shake');
        setTimeout(() => c.classList.remove('hit-shake'), 320);
    };
    const updateParticles = () => {
        // 超出上限时丢弃最旧的粒子，粒子总数永远不会无限增长
        if (particles.length > MAX_PARTICLES) {
            particles.splice(0, particles.length - MAX_PARTICLES);
        }
        for (let i = particles.length - 1; i >= 0; i--) {
            const pt = particles[i];
            pt.x += pt.vx;
            pt.y += pt.vy;
            if (pt.vrot) pt.rot += pt.vrot; // 玻璃碎片自旋
            // 上浮文字保持匀速上升；其余粒子带阻尼减速
            if (pt.kind !== 'text') {
                pt.vx *= 0.96;
                pt.vy *= 0.96;
            }
            pt.life -= pt.decay;
            if (pt.life <= 0) particles.splice(i, 1);
        }
    };
    // 五角星（金色星星反馈用）
    const drawStar = (x, y, r, color, alpha) => {
        ctx.globalAlpha = Math.max(alpha, 0);
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const a = -Math.PI / 2 + (Math.PI * 2 * i) / 5;
            const a2 = a + Math.PI / 5;
            ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
            ctx.lineTo(x + Math.cos(a2) * r * 0.45, y + Math.sin(a2) * r * 0.45);
        }
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
    };
    const drawParticles = () => {
        particles.forEach((pt) => {
            if (pt.kind === 'gold') {
                drawStar(pt.x, pt.y, pt.size + 2, '#ffd54f', pt.life);
            } else if (pt.kind === 'storm-star') {
                // 甜品风暴：金色甜品星星
                drawStar(pt.x, pt.y, pt.size + 3, '#ffe082', pt.life);
            } else if (pt.kind === 'shard') {
                // 玻璃泡泡碎片：自旋的小三角片（白/淡紫）
                ctx.save();
                ctx.globalAlpha = Math.max(pt.life, 0);
                ctx.translate(pt.x, pt.y);
                ctx.rotate(pt.rot || 0);
                ctx.fillStyle = pt.color;
                ctx.beginPath();
                ctx.moveTo(0, -pt.size);
                ctx.lineTo(pt.size * 0.8, pt.size * 0.7);
                ctx.lineTo(-pt.size * 0.8, pt.size * 0.7);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            } else if (pt.kind === 'bubble') {
                // 玻璃泡泡碎裂小圈：淡紫描边圆，轻盈上飘
                ctx.globalAlpha = Math.max(pt.life, 0);
                ctx.strokeStyle = 'rgba(206,147,216,0.9)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
                ctx.stroke();
                ctx.globalAlpha = 1;
            } else if (pt.kind === 'text') {
                // 上浮的 "+分数" 收集反馈
                ctx.globalAlpha = Math.max(pt.life, 0);
                ctx.fillStyle = pt.color || '#5d4a66';
                ctx.font = `bold ${pt.size || 12}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.fillText(pt.text, pt.x, pt.y);
                ctx.globalAlpha = 1;
            } else {
                // burst=甜品本色粒子；purple/green=伙伴特效；storm-*=甜品风暴喷发
                ctx.globalAlpha = Math.max(pt.life, 0);
                ctx.fillStyle = pt.color || (pt.kind === 'purple' ? '#ba68c8'
                    : pt.kind === 'hit' ? '#ef9a9a'
                    : pt.kind === 'storm-pink' ? '#f8bbd0'
                    : pt.kind === 'storm-mint' ? '#a5e5d8'
                    : pt.kind === 'storm-gold' ? '#ffe082'
                    : '#81c784');
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
        });
    };

    // 紫色布丁护盾：玻璃泡泡 PNG（assets/紫色护盾.png 素材原样+整体 35% 透明度）
    // 动画全部无状态时间驱动（Date.now），不引入额外重置逻辑：
    // ① 呼吸 98%~102% / 1.5s  ② 两条淡紫柔光弧贴内侧 18s/圈缓慢流转
    // ③ 4 颗小星屑在盾内缓慢漂移+闪烁（不遮挡角色）
    const SHIELD_STARDUST = [
        { r: 0.34, a0: 0.5, spd: 0.00042, sz: 2.6, ph: 0.0, col: '#ffffff' },
        { r: 0.22, a0: 2.6, spd: -0.00035, sz: 2.0, ph: 1.4, col: '#e1bee7' },
        { r: 0.42, a0: 4.2, spd: 0.00028, sz: 3.0, ph: 2.6, col: '#f3e5f5' },
        { r: 0.28, a0: 5.3, spd: -0.00048, sz: 2.2, ph: 4.1, col: '#ffffff' }
    ];
    const drawShieldBubble = () => {
        if (!(player.isShielded || player.shieldCharges > 0)) return;
        const cx = player.x + player.width / 2;
        const cy = player.y + player.height / 2;
        const R = player.width * 1.05; // 盾半径：完整包裹糯米团 + 飞船
        const t = Date.now();
        if (imgReady(shieldImage)) {
            const breath = 1 + 0.02 * Math.sin((Math.PI * 2 * t) / 1500); // 1.5s 呼吸
            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(breath, breath);
            ctx.globalAlpha = 0.35; // 素材整体半透明，角色清晰可见
            const b = shieldBounds;
            if (b) {
                // 按 onload 扫描的 alpha bbox 源裁剪：去除素材透明边距，泡泡主体精确贴合盾径
                ctx.drawImage(shieldImage, b.sx, b.sy, b.sw, b.sh, -R, -R, R * 2, R * 2);
            } else {
                // bbox 未就绪/像素读取受限：按素材整体比例兜底（泡泡主体约占该素材宽度 75%）
                const nw = shieldImage.naturalWidth, nh = shieldImage.naturalHeight;
                const w = (R * 2) / 0.75;
                ctx.drawImage(shieldImage, -w / 2, -(w * nh / nw) / 2, w, w * nh / nw);
            }
            ctx.globalAlpha = 1;
            // 淡紫流光弧：两条对称柔光弧沿盾缘缓慢旋转（柔和不抢戏）
            const ang = (Math.PI * 2 * t) / 18000;
            ctx.lineCap = 'round';
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            ctx.beginPath();
            ctx.arc(0, 0, R * 0.87, ang, ang + Math.PI * 0.55);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(225,190,231,0.32)';
            ctx.beginPath();
            ctx.arc(0, 0, R * 0.87, ang + Math.PI, ang + Math.PI * 1.45);
            ctx.stroke();
            // 内部星屑：缓慢环绕漂移 + 轻微上下浮动与闪烁
            SHIELD_STARDUST.forEach((s) => {
                const a = s.a0 + t * s.spd;
                const sx = Math.cos(a) * R * s.r;
                const sy = Math.sin(a) * R * s.r + Math.sin(t / 900 + s.ph) * 2;
                drawStar(sx, sy, s.sz, s.col, 0.3 + 0.28 * Math.sin(t / 700 + s.ph));
            });
            ctx.restore();
        } else {
            // 素材未生成：退回旧程序描边泡泡占位（游戏不白屏）
            ctx.beginPath();
            ctx.arc(cx, cy, player.width * 0.8, 0, Math.PI * 2);
            ctx.strokeStyle = '#ba68c8';
            ctx.lineWidth = 3;
            ctx.stroke();
        }
    };

    // 稀有/特殊甜品反馈：星光迸发 + 上浮飘字 + 画布轻闪 + 轻快铃声
    // （柔和梦幻的甜品惊喜感，不做夸张战斗特效）
    const playRareDessertChime = (isSpecial) => {
        try {
            const s = SettingsUI.getSettings();
            if (!s.sound) return; // 遵守设置里的音效开关
            const peak = 0.2 * (typeof s.sfxVolume === 'number' ? s.sfxVolume : 0.9); // 音效音量联动（峰值 0.1×2：与收集音效同步放大，仍远离满幅无失真）
            if (peak <= 0.0001) return; // 音量为 0：静默跳过（exponentialRamp 不接受 0）
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            playRareDessertChime.ctx = playRareDessertChime.ctx || new AudioCtx();
            const audio = playRareDessertChime.ctx;
            if (audio.state === 'suspended') audio.resume();
            const now = audio.currentTime;
            // 上行两音小铃铛（特殊甜品追加第三音），轻快不吵
            const notes = isSpecial ? [880, 1174.66, 1567.98] : [880, 1174.66];
            notes.forEach((freq, i) => {
                const osc = audio.createOscillator();
                const gain = audio.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;
                const t0 = now + i * 0.09;
                gain.gain.setValueAtTime(0.0001, t0);
                gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
                osc.connect(gain).connect(audio.destination);
                osc.start(t0);
                osc.stop(t0 + 0.3);
            });
        } catch (e) { /* WebAudio 不可用时静默跳过，不影响玩法 */ }
    };

    const showRareDessertFeedback = (rarity, cx, cy) => {
        const isSpecial = rarity === 'legendary';
        const label = isSpecial ? '发现特殊甜品！' : '发现稀有甜品！';
        const glowColors = isSpecial
            ? ['#ffe082', '#fff3d6', '#f8bbd0']   // 特殊：奶油金 + 樱花粉
            : ['#a5e5d8', '#f8bbd0', '#ffffff'];  // 稀有：薄荷 + 樱花 + 白
        // 特殊甜品反馈更明显：18 颗星光 + 追加一圈甜品星星光环
        for (let i = 0; i < (isSpecial ? 18 : 12); i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 1 + Math.random() * 1.8;
            particles.push({
                x: cx, y: cy,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.8,
                life: 1, decay: 0.02 + Math.random() * 0.015,
                size: 2 + Math.random() * 2.5,
                kind: i % 3 === 0 ? 'storm-star' : 'burst',
                color: glowColors[i % glowColors.length]
            });
        }
        if (isSpecial) {
            // 追加一圈金色甜品星星光环（可爱的小庆祝，不夸张）
            for (let i = 0; i < 8; i++) {
                const a = (Math.PI * 2 * i) / 8;
                particles.push({
                    x: cx, y: cy,
                    vx: Math.cos(a) * 2.4, vy: Math.sin(a) * 2.4 - 0.6,
                    life: 1, decay: 0.016,
                    size: 2.5, kind: 'storm-star'
                });
            }
        }
        // 画布内上浮飘字提示（特殊甜品字号更大更醒目）
        particles.push({
            x: cx, y: cy - 14,
            vx: 0, vy: -0.7,
            life: 1, decay: 0.012,
            size: isSpecial ? 16 : 14, kind: 'text',
            text: label,
            color: isSpecial ? '#d9a441' : '#e57fa3'
        });
        // 短暂闪光：画布轻微提亮一下下（柔和，不刺眼）
        canvas.classList.remove('rare-dazzle');
        void canvas.offsetWidth; // 强制重排以重启动画
        canvas.classList.add('rare-dazzle');
        setTimeout(() => canvas.classList.remove('rare-dazzle'), 600);
        playRareDessertChime(isSpecial);
    };

    // 甜品收集反馈：一小撮甜品本色粒子 + 上浮的 "+分数"
    // （直接碰撞与绿色伙伴吸附两条收集路径都经过这里，在此统一积累风暴值）
    const spawnCollectEffect = (c) => {
        const cx = c.x + c.width / 2, cy = c.y + c.height / 2;
        // 稀有/特殊甜品：额外惊喜反馈（星光 + 飘字 + 闪光 + 轻音）
        const dexEntry = c.type && DESSERT_DEX[c.type.name];
        // 收集音效：普通甜品 bubble pop（可连续叠加）；稀有/传说（薄荷气泡水/
        // 草莓蛋糕/星糖）magic sparkle——直接碰撞与伙伴吸附两条路径都经过这里。
        // COLLECT_SFX_GAIN：用户反馈偏小，增益 ×2（实际音量封顶 1.0）
        AudioManager.playSfx(dexEntry && dexEntry.rarity !== 'common' ? 'sparkle' : 'pop', COLLECT_SFX_GAIN);
        if (dexEntry && (dexEntry.rarity === 'rare' || dexEntry.rarity === 'legendary')) {
            showRareDessertFeedback(dexEntry.rarity, cx, cy);
        }
        // 收集甜品 → 风暴值：普通甜品 +5%（稀有/特殊按稀有度加成）
        gainStormEnergy(STORM_ENERGY_BY_RARITY[dexEntry ? dexEntry.rarity : 'common']
            || STORM_ENERGY_BY_RARITY.common);
        const color = c.color || (c.type && c.type.color) || '#ffffff';
        for (let i = 0; i < 6; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 0.8 + Math.random() * 1.4;
            particles.push({
                x: cx, y: cy,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.5,
                life: 1, decay: 0.04 + Math.random() * 0.02,
                size: 1.5 + Math.random() * 1.5,
                kind: 'burst', color
            });
        }
        particles.push({
            x: cx, y: c.y,
            vx: 0, vy: -0.8,
            life: 1, decay: 0.02,
            size: 12, kind: 'text',
            text: '+' + (c.type ? c.type.points : 0),
            color: '#5d4a66'
        });
    };

    // Mobile controls
    let touchStartX = 0;
    let touchStartY = 0;
    let virtualButtons = {}; // To hold references to virtual buttons

    class GameObject {
        constructor(x, y, width, height, color, type, imageSrc = null) {
            this.x = x;
            this.y = y;
            this.width = width;
            this.height = height;
            this.color = color;
            this.type = type;
            this.speed = 2; // Objects move from right to left
            this.image = null;
            if (imageSrc) {
                this.image = new Image();
                this.image.src = imageSrc;
            }
        }

        update() {
            this.x -= this.speed;
        }

        draw() {
            if (imgReady(this.image)) {
                ctx.drawImage(this.image, this.x, this.y, this.width, this.height);
            } else {
                ctx.fillStyle = this.color;
                ctx.fillRect(this.x, this.y, this.width, this.height);
            }
        }

        isOffScreen() {
            return this.x + this.width < 0;
        }

        collidesWith(other) {
            return this.x < other.x + other.width &&
                   this.x + this.width > other.x &&
                   this.y < other.y + other.height &&
                   this.y + other.height > other.y;
        }
    }

    // 冰晶 PNG 雾底清理：该素材背景是一层中性灰的方形薄雾（边框一圈 alpha 高达 ~97，
    // 内部 6~127 渐变），直接绘制会显示"浅灰方形底板"。不改素材文件——图片加载后在
    // 离屏画布上从四边 flood fill，只清除与边框连通的【灰色雾底】：
    // 雾底特征 = 低透明（alpha<128）且中性灰（R/G/B 色差<25）；
    // 晶体本体 alpha≥128 或带蓝色调，完全不满足特征 → 零侵蚀（实测 body_eaten=0，
    // 清理后边框 3px 环仅剩 2 个晶体自身的蓝色像素，四角全透明）。
    // 结果存 type.fogCanvas 供 draw 使用；像素读取受限（file:// 跨域）时保留原样绘制
    const ICE_FOG_MAX_ALPHA = 128;  // 雾底 alpha 上限（本体 ≥128 永不清除）
    const ICE_FOG_MAX_GRAYNESS = 25; // 中性灰判定：RGB 通道最大差值（晶体为蓝白色调，色差大）
    const setupIceFogCleanup = (img, type) => {
        const clean = () => {
            if (type.fogCanvas) return;
            try {
                const w = img.naturalWidth, h = img.naturalHeight;
                const oc = document.createElement('canvas');
                oc.width = w;
                oc.height = h;
                const octx = oc.getContext('2d');
                octx.drawImage(img, 0, 0);
                const id = octx.getImageData(0, 0, w, h);
                const d = id.data;
                const visited = new Uint8Array(w * h);
                const stack = [];
                // 灰色雾底判定：低 alpha 且 RGB 近中性（雾底是灰蒙蒙的半透明底，
                // 晶体本体/蓝色抗锯齿边缘色差明显，不会被误判）
                const isFog = (i) => {
                    const p = i * 4;
                    if (d[p + 3] >= ICE_FOG_MAX_ALPHA) return false;
                    const r = d[p], g = d[p + 1], b = d[p + 2];
                    return (Math.max(r, g, b) - Math.min(r, g, b)) < ICE_FOG_MAX_GRAYNESS;
                };
                const seed = (x, y) => {
                    const i = y * w + x;
                    if (!visited[i] && isFog(i)) {
                        visited[i] = 1;
                        stack.push(i);
                    }
                };
                for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
                for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
                while (stack.length) {
                    const i = stack.pop();
                    d[i * 4 + 3] = 0; // 与边框连通的灰色雾底 → 全透明
                    const x = i % w, y = (i / w) | 0;
                    if (x > 0) seed(x - 1, y);
                    if (x < w - 1) seed(x + 1, y);
                    if (y > 0) seed(x, y - 1);
                    if (y < h - 1) seed(x, y + 1);
                }
                octx.putImageData(id, 0, 0);
                type.fogCanvas = oc; // draw 改用清理后的画布源
            } catch (e) { /* 像素读取受限：保留原图绘制 */ }
        };
        if (imgReady(img)) clean();
        else img.addEventListener('load', clean, { once: true });
    };

    // PNG 障碍物：在通用 GameObject 上叠加三种动画（素材 256² 画布 → 统一 64×64 绘制）
    // 【重要】碰撞体始终固定 size×size：帧循环/漂浮/呼吸只影响绘制，不影响判定框；
    // 漂浮是唯一的例外——整个障碍物（含碰撞框）随 Y 一起浮动，属物理位移而非形变
    class Obstacle extends GameObject {
        constructor(x, y, size, type) {
            super(x, y, size, size, type.color, type, ASSETS.obstaclePng(type.name));
            // 动态难度：按当前积分倍率缩放水平速度（冰晶封顶 +25%）。
            // 只影响新生成的障碍，场上已有障碍保持原速 → 难度平滑过渡
            // （手机端整体再 ×0.9：MOBILE_DIFF.obstSpeed；风暴云(龙卷风)追加
            // ×0.8：MOBILE_DIFF.tornadoSpeed，真机测其游走速度仍偏快）
            this.speed = 2 * getObstacleSpeedMul(type) * MOBILE_DIFF.obstSpeed *
                (type.wander ? MOBILE_DIFF.tornadoSpeed : 1);
            this.baseY = y;          // 漂浮基准线（findSpawnY 给出的防重叠位置）
            this.bornAt = Date.now(); // 动画相位基准（暂停时 update 不跑，恢复后相位前跳，与现有计时风格一致）
            // 冰晶雾底清理（type 共享，_fogDone 防重复启动）
            if (type.name === 'ice_crystal' && !type._fogDone) {
                type._fogDone = true;
                setupIceFogCleanup(this.image, type);
            }
            // 智能游走（风暴云）：初始目标 = 水平向左直行，首个换向点随机落在 0.8~1.5 秒后
            if (type.wander) {
                const w = type.wander;
                const mul = getObstacleSpeedMul(type) * MOBILE_DIFF.obstSpeed * MOBILE_DIFF.tornadoSpeed; // 推进速度同样吃难度倍率（含手机端×0.9 与风暴云追加×0.8）
                this.wander = {
                    vx: -w.baseSpeed * mul, vy: 0,
                    tvx: -w.baseSpeed * mul, tvy: 0,
                    nextTurnAt: Date.now() + w.turnMinMs + Math.random() * (w.turnMaxMs - w.turnMinMs)
                };
            }
        }

        update() {
            if (this.type.wander) {
                this.updateWander();
            } else {
                this.x -= this.speed;
            }
            // 漂浮（冰晶）：y = 基准 + sin·±4px，缓慢上下
            if (this.type.anim === 'float') {
                const t = Date.now() - this.bornAt;
                this.y = this.baseY + Math.sin((Math.PI * 2 * t) / this.type.floatMs) * this.type.floatAmp;
            }
        }

        // 风暴云随机游走：始终向左推进（vx 恒为负），垂直速度每 0.8~1.5 秒随机变化一次，
        // 逐帧平滑逼近目标速度 → 轨迹圆滑无折线；触碰上下边界自然反弹，永不穿出屏幕；
        // 碰撞体（width/height）不随移动/动画改变，恒定 64²
        updateWander() {
            const w = this.type.wander;
            const st = this.wander;
            const now = Date.now();
            // 到期换向：水平目标速度在 0.75~1.25 倍基准速度间随机（恒为负），
            // 垂直目标速度全幅随机 × 灵敏度倍率（难度提升 → 游走更灵活/漂浮范围更大）
            if (now >= st.nextTurnAt) {
                const base = w.baseSpeed * (this.speed / 2); // 生成时已含难度倍率，回推基准
                st.tvx = -base * (0.75 + Math.random() * 0.5);
                st.tvy = (Math.random() * 2 - 1) * w.vyMax * difficulty.cloudAgilityMul;
                st.nextTurnAt = now + w.turnMinMs + Math.random() * (w.turnMaxMs - w.turnMinMs);
            }
            // 指数平滑转向：速度连续变化，转向自然圆滑
            st.vx += (st.tvx - st.vx) * w.steer;
            st.vy += (st.tvy - st.vy) * w.steer;
            this.x += st.vx;
            this.y += st.vy;
            // 上下边界反弹：位置夹回界内，实际速度与目标速度同时反向（平滑弹回场景内）
            if (this.y < 0) {
                this.y = 0;
                st.vy = Math.abs(st.vy);
                st.tvy = Math.abs(st.tvy);
            } else if (this.y + this.height > canvas.height) {
                this.y = canvas.height - this.height;
                st.vy = -Math.abs(st.vy);
                st.tvy = -Math.abs(st.tvy);
            }
        }

        draw() {
            const t = Date.now() - this.bornAt;
            let dx = this.x, dy = this.y, dw = this.width, dh = this.height;
            if (this.type.anim === 'breath') {
                // 呼吸（泡泡）：围绕中心 0.95~1.05 缩放，仅视觉，碰撞框不动
                const s = 1 + this.type.breathAmp * Math.sin((Math.PI * 2 * t) / this.type.breathMs);
                dw = this.width * s;
                dh = this.height * s;
                dx = this.x + (this.width - dw) / 2;
                dy = this.y + (this.height - dh) / 2;
            }
            ctx.globalAlpha = this.type.alpha || 1;
            if (imgReady(this.image)) {
                if (this.type.anim === 'sheet') {
                    // Sprite Sheet 横向等分循环：1→2→3→1，每帧 frameMs
                    const fw = this.image.naturalWidth / this.type.frames;
                    const fi = Math.floor(t / this.type.frameMs) % this.type.frames;
                    ctx.drawImage(this.image, fi * fw, 0, fw, this.image.naturalHeight,
                                  this.x, this.y, this.width, this.height);
                } else {
                    // 冰晶优先用雾底清理后的画布源（无方形雾底），其余障碍画原图
                    ctx.drawImage(this.type.fogCanvas || this.image, dx, dy, dw, dh);
                }
            }
            // 素材未就绪：不绘制任何矩形占位（原 fillRect 色块已删），障碍短暂隐形；
            // 碰撞体保持生效，图片就绪后立即正常显示
            ctx.globalAlpha = 1;
        }
    }

    // 生成安全间距：新物体与场上任何物体（收集物/障碍物/玩偶）至少保持该空隙，
    // 避免视觉贴在一起（用户建议 12–20px，PC 取 16）。
    // 手机端 26：画布更矮（障碍占屏比例更大），加大间距减少"几乎无法躲避"的组合，
    // 尤其糖果泡泡/风暴云与冰晶之间的贴脸生成（间距越大，生成重试越容易跳过该位置）
    const SPAWN_GAP = MOBILE_DIFF.spawnGap;
    // 在右边缘为 size×size 的新物体找一个不与场上任何物体重叠的 y：
    // 全部物体同速向左（speed 相同），水平间距不会缩小 —— 只有生成时刻水平方向
    // 有交叠（旧物体尚未完全进入画面）才可能重叠，此时要求 y 区间分离出安全间距；
    // 最多重试 24 次，全部失败返回 null（跳过本次生成，等下一个生成周期再试）
    const findSpawnY = (size) => {
        for (let attempt = 0; attempt < 24; attempt++) {
            const y = Math.random() * (canvas.height - size);
            let ok = true;
            const checkAgainst = (o) => {
                if (!ok) return;
                // 旧物体左边缘已完全进入画面 → 今后与新物体水平方向永不相交，无需比较
                if (o.x + o.width <= canvas.width) return;
                // 水平方向有交叠：要求 y 区间（含安全间距）分离
                if (y < o.y + o.height + SPAWN_GAP && y + size + SPAWN_GAP > o.y) ok = false;
            };
            for (const c of collectibles) checkAgainst(c);
            for (const o of obstacles) checkAgainst(o);
            for (const b of earthenBeasts) checkAgainst(b);
            if (ok) return y;
        }
        return null;
    };

    const spawnCollectible = () => {
        // 动态掉落：按本局积分取概率分档（开局几乎全普通，分越高稀有/传说越高）
        // + 硬约束（星糖每局 1 个 / 传说间隔 25 普通 / 稀有连击 ≤2）。
        // 只依赖本局积分，图鉴解锁状态不影响掉落。
        const tier = rollDropTier();
        const tierTypes = COLLECTIBLE_RARITY_POOL[tier];
        const type = tierTypes[Math.floor(Math.random() * tierTypes.length)];
        const size = Math.round(COLLECTIBLE_BASE_SIZE * COLLECTIBLE_SCALE_BY_TIER[tier]); // 基准框 × 稀有度缩放
        const y = findSpawnY(size);
        if (y === null) return; // 与场上物体重叠且找不到空位：跳过本次生成
        // Placeholder image sources for collectibles
        const imageSrc = ASSETS.collectible(type.name);
        collectibles.push(new GameObject(canvas.width, y, size, size, type.color, type, imageSrc));
    };

    const spawnObstacle = () => {
        if (!OBSTACLE_TYPES) return; // manifest 尚未构建完成（极端情况）：跳过本次生成
        // 按权重抽取（weight 可配置出现概率，后期只改 OBSTACLE_PRESETS 里的数字）；
        // 动态难度：冰晶额外叠加 iceBias 权重（第一关 Lv4 起冰晶略增）
        const weightOf = (t) => (t.weight || 30) + (t.name === 'ice_crystal' ? difficulty.iceBias : 0);
        const totalW = OBSTACLE_TYPES.reduce((s, t) => s + weightOf(t), 0);
        let roll = Math.random() * totalW;
        let type = OBSTACLE_TYPES[0];
        for (const t of OBSTACLE_TYPES) {
            roll -= weightOf(t);
            if (roll < 0) { type = t; break; }
        }
        const size = OBSTACLE_SIZE; // 统一 64×64，素材等比缩放不拉伸
        // 智能游走风暴云同屏最多 2 个（避免难度过高）：超限跳过本次生成
        if (type.wander) {
            let wanderCount = 0;
            for (const o of obstacles) {
                if (o.type.wander) wanderCount++;
            }
            if (wanderCount >= WANDER_MAX_ONSCREEN) return;
        }
        const y = findSpawnY(size);
        if (y === null) return; // 与场上物体重叠且找不到空位：跳过本次生成
        obstacles.push(new Obstacle(canvas.width, y, size, type));
    };

    const spawnEarthenBeast = () => {
        const type = EARTHEN_BEAST_TYPES[Math.floor(Math.random() * EARTHEN_BEAST_TYPES.length)];
        const size = 35 + Math.random() * 15;
        const y = findSpawnY(size);
        if (y === null) return; // 与场上物体重叠且找不到空位：跳过本次生成
        const imageSrc = ASSETS.beast(type.name);
        earthenBeasts.push(new GameObject(canvas.width, y, size, size, type.color, type, imageSrc));
    };

    // 收集野生甜品玩偶 → 该玩偶成为跟随伙伴（独立对象，绝不成为玩家）
    // 单次陪伴最长 5 秒（PARTNER_MAX_MS），到期自动平滑离场；
    // 提前离场情形：被其他玩偶替换 / 紫色护盾挡一次后立即消失 / 重开局重置
    const activateBeastCompanion = (type, fromX, fromY) => {
        type.count = (type.count || 0) + 1; // 玩偶收藏数量 +1（随存档持久化）
        saveProfile();                      // 本地存档自动保存（内部防抖）
        const p = earthenBeastPartner;
        p.variant = type.name;
        p.isVisible = true;
        p.color = type.color; // 色块占位时也能看出当前颜色
        p.x = fromX;          // 从被收集的位置缓动飞向跟随位，不瞬移
        p.y = fromY;
        p.endTime = Date.now() + PARTNER_MAX_MS; // 陪伴倒计时起点（5 秒上限；再吃新玩偶会重置）
        p.alpha = 1;                             // 新伙伴从不透明开始（替换淡出中的旧伙伴时也要复位）
        // 紫色：泡泡护盾自激活起共 7 秒（跟随 5 秒 + 独立续航 2 秒），到点立即消失
        p.shieldUntil = type.effect === 'shield'
            ? p.endTime + SHIELD_EXTEND_MS
            : 0;
        if (type.effect === 'shield') {
            player.shieldCharges = 1; // 紫色：泡泡护盾，抵挡一次伤害
        }
        showBeastTimer(); // 显示陪伴倒计时气泡（薄荷圆环 + 剩余秒数）
        spawnParticles(fromX, fromY, type.name === 'blue' ? 'gold' : type.name);
        console.log(`Earthen beast companion joined: ${type.name}`);
    };

    // 伙伴离场（到期/护盾消耗/跨局重置共用）：清能力、复位淡出状态、隐藏倒计时。
    // 能力随 variant 清除而停止（绿=吸附 / 蓝=加分即停；紫色护盾走 expireShield 单独清）
    const deactivateBeastPartner = () => {
        const p = earthenBeastPartner;
        p.isVisible = false;
        p.variant = null;
        p.endTime = 0;
        p.shieldUntil = 0;
        p.alpha = 1;
        hideBeastTimer();
        console.log('Earthen beast companion left.');
    };

    // 紫色专属阶段一：跟随 5 秒结束 → 玩偶离场，护盾独立续航至第 7 秒（计时器继续倒数护盾时间）
    const enterShieldOnlyPhase = () => {
        const p = earthenBeastPartner;
        p.isVisible = false;
        p.alpha = 1; // 复位淡出状态（玩偶已离场；护盾继续存在）
        console.log('Purple pudding follow ended; shield remains for 2 more seconds.');
    };

    // 紫色专属终点：第 7 秒到期 / 护盾挡一次碰撞 → 立即清除，不渐隐不延迟
    const expireShield = () => {
        player.shieldCharges = 0;
        deactivateBeastPartner();
        console.log('Purple shield expired.');
    };

    const background = {
        x: 0,
        speed: 1,
        image: new Image()
    };
    let cloudOffset = 0; // 占位云朵的滚动偏移量（背景图未加载时使用）

    // ============================================================
    // 关卡背景：整图横向循环（repeat-x，各关卡统一逻辑）
    // 素材高度固定铺满屏幕（纵向不平铺、不裁带叠层），悬浮岛/树作为
    // 整图的一部分只出现一次、整图同速移动（树冠+树干永不分离）；
    // 素材左右边缘不衔接 → [正, 镜像] 交替平铺实现无缝横向循环。
    // ============================================================
    let bgScroll = 0;   // 背景横向滚动总里程（浮点像素）
    let bgLastTime = 0; // 滚动帧时间基准（deltaTime 驱动；暂停时不跑，恢复首帧夹 50ms）

    // 镜像平铺绘制：按素材宽高比铺满指定高度，[正, 镜像] 交替横向铺满画布；
    // 全程浮点坐标不取整（亚像素平滑），杜绝移动时的像素抖动
    const drawTiledMirrored = (source, offsetX, dstY, dstH, alpha) => {
        const w = dstH * (source.naturalWidth / source.naturalHeight); // 保持素材比例的单元宽
        if (!(w > 0)) return;
        const period = w * 2;
        const off = ((offsetX % period) + period) % period; // 归一到 [0, 2w)
        if (alpha < 1) ctx.globalAlpha = alpha;
        let x = -off;
        let i = 0;
        while (x < canvas.width) {
            if (x + w > 0) {
                if (i % 2 === 1) {
                    ctx.save();
                    ctx.translate(x + w, dstY);
                    ctx.scale(-1, 1);
                    ctx.drawImage(source, 0, 0, w, dstH);
                    ctx.restore();
                } else {
                    ctx.drawImage(source, x, dstY, w, dstH);
                }
            }
            x += w;
            i++;
        }
        if (alpha < 1) ctx.globalAlpha = 1;
    };

    const keys = {};

    const updatePlayer = () => {
        player.x += player.dx;
        player.y += player.dy;

        // Boundary checks
        if (player.x < 0) player.x = 0;
        if (player.x + player.width > canvas.width) player.x = canvas.width - player.width;
        if (player.y < 0) player.y = 0;
        if (player.y + player.height > canvas.height) player.y = canvas.height - player.height;

        // 伙伴缓动跟随：目标位 = 玩家身后偏上（朝向反侧约一个身位）。
        // lerp 缓动：玩家移动时兽稍微滞后，停下时缓缓归位，绝不瞬移。
        if (earthenBeastPartner.isVisible) {
            const p = earthenBeastPartner;
            const behind = player.facing === 'left' ? 1 : -1; // 朝右→兽在左后方
            let tx = player.x + behind * (player.width + 14);
            let ty = player.y - 14; // 稍微向上偏移
            // 玩家贴边时身后放不下：改到玩家正上方，避免叠在玩家身上
            const maxX = canvas.width - p.width - 2;
            if (tx < 2 || tx > maxX) {
                tx = Math.min(Math.max(tx, 2), maxX);
                ty = Math.max(player.y - player.height - 10, 2);
            }
            const k = 0.12; // 缓动系数（越小跟得越"拖"）
            p.x += (tx - p.x) * k;
            p.y += (ty - p.y) * k;
        }
    };

    const updateBackground = () => {
        // 背景图就绪即整图横向循环滚动（各关卡同款；deltaTime 插值 → 帧率无关的平滑移动）
        if (imgReady(background.image)) {
            const now = performance.now();
            const dt = bgLastTime ? Math.min(50, now - bgLastTime) : 16.667;
            bgLastTime = now;
            bgScroll += background.speed * (dt / 16.667);
            return;
        }
        bgLastTime = 0; // 素材未就绪时重置帧基准，防止就绪后首个 dt 跳变
        background.x -= background.speed;
        if (background.x <= -canvas.width) {
            background.x = 0;
        }
        cloudOffset = (cloudOffset + background.speed * 0.6) % (canvas.width + 340);
    };

    const updateStatsDisplay = () => {
        scoreDisplay.textContent = score;
        livesDisplay.textContent = lives;
        // Update Red Clay count display (if any)
    };

    // 绿色大地兽吸附半径：只吸附"附近"的甜品，而不是全场
    const ATTRACT_RADIUS = 180;
    const isWithinAttractRange = (c) => {
        const dx = player.x + player.width / 2 - (c.x + c.width / 2);
        const dy = player.y + player.height / 2 - (c.y + c.height / 2);
        return dx * dx + dy * dy <= ATTRACT_RADIUS * ATTRACT_RADIUS;
    };

    // 主角三态表情推进：eating 满 0.2 秒 → happy，happy 满 0.4 秒 → normal。
    // update() 每帧调用；单独提成函数便于测试 hook 直驱（自动化环境 rAF 可能挂起）
    const advanceFaceState = () => {
        if (player.faceState === 'normal' || Date.now() <= player.faceStateUntil) return;
        if (player.faceState === 'eating') {
            player.faceState = 'happy';
            player.faceStateUntil = Date.now() + 400;
        } else {
            player.faceState = 'normal';
        }
    };

    // ============================================================
    // 玩家合成绘制：甜品飞船（底层）+ 白色糯米团（驾驶舱内）+ 舱盖前沿遮挡。
    // 飞船与糯米团在此按固定相对位置一次画完 → 两者永远同步移动；
    // 三态表情始终画在同一个矩形上（同锚点同尺寸），切换不会跳动；
    // 最后沿玻璃面下沿 clip 重绘飞船，把糯米团下沿盖进舱内 → "坐在舱里"
    // 吃到甜品的 0.3 秒内整体轻微放大(Pop) + 开心小跳，强化收集反馈
    // ============================================================
    const drawPlayer = () => {
        // 受击闪烁：hitFlash 期间每 100ms 隔帧隐藏（经典受击反馈，不改变判定）
        if (player.hitFlashUntil > Date.now() && Math.floor(Date.now() / 100) % 2 === 0) return;
        const shipReady = imgReady(shipImage);
        // 角色衣柜：按当前装备皮肤取三态表情图集（只替换绘制源 PNG，
        // 碰撞箱与属性不变）；皮肤素材缺失时回退默认白糯米团图集
        const skinSet = skinStateImages[GameManager.getSelectedSkin()] || playerStateImages;
        const faceImg = skinSet[player.faceState];
        const baseImg = imgReady(faceImg) ? faceImg : player.image;
        const faceReady = imgReady(baseImg);
        if (!shipReady) {
            // 飞船未就绪：退回独立角色绘制（保持原 40×40 行为）；
            // 双资源都未就绪才用色块兜底（正常不应出现）
            if (faceReady) {
                ctx.drawImage(baseImg, player.x, player.y, player.width, player.height);
            } else {
                ctx.fillStyle = '#5e9b84';
                ctx.fillRect(player.x, player.y, player.width, player.height);
            }
            return;
        }
        // 飞船绘制边长 S：素材 1296×1296 等比缩放。
        // 移动端可视性优化：整体放大约 25%（60 → 75），Q 版比例/锚点不变不拉伸
        const S = 75;
        const sx = player.x - 14, sy = player.y - 27; // 飞船内容视觉中心对齐原玩家框中心
        // 收集反馈动画：吃到甜品后 0.3 秒内轻微 Pop 放大 + 小跳（弹性衰减曲线）
        const popLeft = player.popUntil - Date.now();
        const inPop = popLeft > 0;
        if (inPop) {
            const t = 1 - popLeft / 300; // 0→1 弹跳进度
            const pop = 0.10 * Math.sin(Math.PI * t) * (1 - 0.4 * t);
            const hop = 5 * Math.sin(Math.PI * t);
            const cx = player.x + player.width / 2, cy = player.y + player.height / 2;
            ctx.save();
            ctx.translate(cx, cy - hop);
            ctx.scale(1 + pop, 1 + pop);
            ctx.translate(-cx, -cy);
        }
        ctx.drawImage(shipImage, sx, sy, S, S);
        if (faceReady) {
            // 糯米团坐进玻璃驾驶舱：直径 0.30S，圆心对准玻璃面中心 (0.4883S, 0.43S)
            const d = 0.30 * S;
            const nx = sx + 0.4883 * S - d / 2;
            const ny = sy + 0.43 * S - d / 2;
            ctx.drawImage(baseImg, nx, ny, d, d);
            // 舱盖前沿遮挡：clip 玻璃面椭圆下半带（弦线 sinθ=0.3）后重绘飞船，
            // 糯米团下沿约 15% 被玻璃前沿盖住 → 一眼看出坐在舱内而非悬浮
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(sx + 0.4883 * S, sy + 0.5156 * S,
                        0.1641 * S, 0.0664 * S, 0,
                        Math.asin(0.3), Math.PI - Math.asin(0.3));
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(shipImage, sx, sy, S, S);
            ctx.restore();
        }
        if (inPop) ctx.restore();
    };

    const update = () => {
        updatePlayer();
        updateBackground();

        const currentTime = Date.now();
        // 护盾状态：守护兽技能已移除，shieldEndTime 恒为 0（字段保留给紫色布丁泡泡判定）；
        // 紫色布丁护盾由 shieldCharges（抵挡一次伤害，挡后立即消失）+ 7 秒时限（见伙伴倒计时段）共同管理
        // 【修复】移除原先按"技能冷却时间戳"反推伙伴可见性的错误逻辑：
        // 它会在冷却的最后3秒莫名显示伙伴并强制开盾，且跨局残留。
        player.isShielded = currentTime < player.shieldEndTime;

        // 帧间时间差（暂停时不调用 update，风暴倒计时自动冻结；单帧上限 50ms 防切页跳变）
        const frameDt = lastFrameTime ? Math.min(50, currentTime - lastFrameTime) : 16;
        lastFrameTime = currentTime;

        // 甜品风暴魔法时间：倒计时 + 梦幻薄荷气泡从底部缓缓上升
        // （移动端气泡生成概率减半，保持氛围的同时降低粒子压力）
        if (stormState.active) {
            stormState.timeLeft -= frameDt;
            if (Math.random() < (IS_TOUCH ? 0.12 : 0.25)) spawnStormAmbient();
            if (stormState.timeLeft <= 0) endStorm();
        }
        // 主角三态表情推进（暂停时 update 不跑，表情倒计时自然冻结）
        advanceFaceState();
        // 甜品玩偶伙伴陪伴倒计时：最长 5 秒，到期自动离场。
        // 最后 2 秒倒计时 UI 转入柔和的"渐弱"态（气泡减少、光效变弱）；
        // 最后 0.8 秒伙伴整体淡出，平滑告别不突兀。
        // 紫色特殊：跟随 5 秒结束后进入"仅护盾"阶段，护盾独立续航至第 7 秒立即消失。
        if (earthenBeastPartner.isVisible || (earthenBeastPartner.variant === 'purple' && player.shieldCharges > 0)) {
            const p = earthenBeastPartner;
            const shieldOnly = !p.isVisible; // 护盾独立续航阶段（玩偶已离场）
            const remaining = (shieldOnly ? p.shieldUntil : p.endTime) - currentTime;
            updateBeastTimerUI(remaining); // 计时器全程同步：跟随期倒 5→0，护盾期倒 2→0
            if (p.isVisible) {
                if (remaining <= 800) {
                    p.alpha = Math.max(0, remaining / 800);
                }
                if (remaining <= 0) {
                    if (p.variant === 'purple' && player.shieldCharges > 0) {
                        enterShieldOnlyPhase(); // 紫色：玩偶离场，护盾再留 2 秒
                    } else {
                        deactivateBeastPartner();
                    }
                }
            } else if (remaining <= 0) {
                expireShield(); // 第 7 秒到：护盾立即消失（无渐隐无延迟）
            }
        }
        // 绿色大地兽伙伴：在场即持续吸附甜品（替代旧的 7 秒计时制）
        player.isAutoCollecting = earthenBeastPartner.variant === 'green';

        // Update and filter collectibles
        for (let i = collectibles.length - 1; i >= 0; i--) {
            const collectible = collectibles[i];
            collectible.update();
            if (collectible.isOffScreen()) {
                collectibles.splice(i, 1);
            } else if (player.collidesWith(collectible, MOBILE_DIFF.collectPad) ||
                       (player.isAutoCollecting && isWithinAttractRange(collectible))) {
                if (!player.collidesWith(collectible, MOBILE_DIFF.collectPad)) {
                    // 绿色大地兽吸附：甜品向玩家缓动靠拢，贴近后才算收集
                    collectible.x += (player.x - collectible.x) * 0.1;
                    collectible.y += (player.y - collectible.y) * 0.1;
                    if (!player.collidesWith(collectible, MOBILE_DIFF.collectPad)) continue; // Not close enough yet
                }
                score += collectible.type.points;
                // 动态难度：积分变化后重算倍率；密度档变化时平滑重建障碍生成定时器
                // （速度倍率由新障碍生成时自然应用，此处无需额外处理）
                recomputeDifficulty();
                refreshObstacleSpawnRate();
                // 蓝色大地兽伙伴加成：每颗甜品额外 +10，并冒金色星星
                if (earthenBeastPartner.variant === 'blue') {
                    score += 10;
                    spawnParticles(collectible.x, collectible.y, 'gold');
                }
                // 通用收集反馈（本色粒子 + 上浮分数）+ 图鉴发现记录
                spawnCollectEffect(collectible);
                // 收集动画：快照原位置/尺寸，350ms 轻微放大 + 淡出（draw 内消费）
                collectFx.push({
                    image: collectible.image,
                    color: collectible.color,
                    x: collectible.x,
                    y: collectible.y,
                    width: collectible.width,
                    height: collectible.height,
                    start: Date.now()
                });
                // 吃到甜品表情动画：先张嘴 eating（0.2 秒），随后幸福 happy（0.4 秒）
                // （阶段推进在 update() 里做，期间再吃到会重新从 eating 开始）
                player.faceState = 'eating';
                player.faceStateUntil = Date.now() + 200;
                // 收集反馈：0.3 秒轻微 Pop 放大 + 开心小跳（drawPlayer 内消费）
                player.popUntil = Date.now() + 300;
                discoverDessert(collectible.type.name);
                runDessertsCollected++; // 本局收集计数（结算界面用）
                checkAchievements();    // 成就判定（纯读取已有数据）
                if (collectible.type.name === 'red_clay') {
                    // redClayCount++; // Increment Red Clay count
                    console.log("Red Clay collected!");
                }
                updateStatsDisplay();
                collectibles.splice(i, 1);
                // TODO: Add particle effect for collection

                if (score >= currentLevel.winScore) {
                    GameManager.showScreen('cgScreen');
                    stop();
                }
            }
        }

        // Update and filter obstacles
        for (let i = obstacles.length - 1; i >= 0; i--) {
            const obstacle = obstacles[i];
            obstacle.update();
            if (obstacle.isOffScreen()) {
                obstacles.splice(i, 1);
            } else if (player.collidesWith(obstacle, 0, MOBILE_DIFF.obstHitbox)) {
                // 手机端障碍碰撞框边长 ×0.9（中心对齐内缩，视觉不变）：
                // 触屏下"贴边擦过"不再掉命，判定与视觉仍基本贴合
                if (player.shieldCharges > 0) {
                    // 紫色布丁护盾：抵挡一次伤害，挡后立即消失（不渐隐不延迟）
                    player.shieldCharges--;
                    if (earthenBeastPartner.variant === 'purple') {
                        // 玻璃泡泡碎裂：白/淡紫碎片 + 小泡泡圈迸开
                        spawnShieldBreak(player.x + player.width / 2, player.y + player.height / 2);
                        expireShield(); // 玩偶 + 计时器 + 护盾一并立即清除
                    }
                } else if (!player.isShielded) {
                    lives--;
                    updateStatsDisplay();
                    // 碰撞音效：冰晶=冰裂 / 糖果泡泡=bubble pop（与普通甜品共用）；
                    // 风暴云无撞击音（只有距离环境音）。
                    // HIT_SFX_GAIN：用户反馈偏小，增益 ×2（实际音量封顶 1.0）
                    const obstacleName = obstacle.type && obstacle.type.name;
                    if (obstacleName === 'ice_crystal') AudioManager.playSfx('ice', HIT_SFX_GAIN);
                    else if (obstacleName === 'candy_bubble') AudioManager.playSfx('pop', HIT_SFX_GAIN);
                    // 受击反馈：糯米团闪烁 0.9s + 珊瑚色粒子迸开 + 容器轻晃
                    player.hitFlashUntil = Date.now() + 900;
                    spawnParticles(player.x + player.width / 2, player.y + player.height / 2, 'hit');
                    triggerHitShake();
                    if (lives <= 0) {
                        GameManager.showScreen('gameOver');
                        stop();
                    }
                }
                obstacles.splice(i, 1);
            }
        }

        // 风暴云环境音：取玩家与最近糖果风暴云的中心距（无云传 null），
        // 150px 内 25% 音量循环播放、离开 0.3 秒淡出；多云只播一份防叠音
        let tornadoDist = null;
        for (let i = 0; i < obstacles.length; i++) {
            const o = obstacles[i];
            if (o.type && o.type.name === 'storm_cloud_sheet') {
                const d = Math.hypot(
                    (o.x + o.width / 2) - (player.x + player.width / 2),
                    (o.y + o.height / 2) - (player.y + player.height / 2)
                );
                if (tornadoDist === null || d < tornadoDist) tornadoDist = d;
            }
        }
        AudioManager.updateTornado(tornadoDist);

        // Update and filter earthen beasts (wild ones)
        for (let i = earthenBeasts.length - 1; i >= 0; i--) {
            const beast = earthenBeasts[i];
            beast.update();
            if (beast.isOffScreen()) {
                earthenBeasts.splice(i, 1);
            } else if (player.collidesWith(beast)) {
                // 三色野生大地兽：收集后成为跟随伙伴，能力随伙伴持续生效
                //（蓝=甜品额外加分+金星 / 紫=泡泡护盾挡一次 / 绿=范围内吸附甜品）
                activateBeastCompanion(beast.type, beast.x, beast.y);
                updateStatsDisplay();
                earthenBeasts.splice(i, 1);
            }
        }

        updateParticles();
    };

    const drawBackground = () => {
        // 背景图就绪：整图横向循环（repeat-x，纵向不平铺；浮岛/树只随整图出现一次）
        if (imgReady(background.image)) {
            drawTiledMirrored(background.image, bgScroll, 0, canvas.height, 1);
            return;
        }
        // 背景图未加载（素材待生成）：绘制马卡龙渐变天空 + 向左滚动的云朵占位
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0, '#bde8f0'); // 马卡龙蓝
        grad.addColorStop(1, '#fdf6ec'); // 奶白
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        const period = canvas.width + 340;
        for (let i = 0; i < 4; i++) {
            const cx = canvas.width + 120 - ((cloudOffset + i * 260) % period);
            const cy = 70 + (i % 2) * 80 + i * 30;
            ctx.beginPath();
            ctx.arc(cx, cy, 28, 0, Math.PI * 2);
            ctx.arc(cx + 30, cy - 12, 22, 0, Math.PI * 2);
            ctx.arc(cx + 58, cy, 26, 0, Math.PI * 2);
            ctx.fill();
        }
    };

    const draw = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear canvas
        drawBackground();

        // Draw collectibles
        collectibles.forEach(collectible => collectible.draw());

        // 收集动画层：原位轻微放大 + 淡出（350ms 生命周期）
        for (let i = collectFx.length - 1; i >= 0; i--) {
            const fx = collectFx[i];
            const t = (Date.now() - fx.start) / 350;
            if (t >= 1) {
                collectFx.splice(i, 1);
                continue;
            }
            const scale = 1 + 0.35 * t;
            const w = fx.width * scale;
            const h = fx.height * scale;
            const cx = fx.x + fx.width / 2;
            const cy = fx.y + fx.height / 2;
            ctx.save();
            ctx.globalAlpha = 1 - t;
            if (imgReady(fx.image)) {
                ctx.drawImage(fx.image, cx - w / 2, cy - h / 2, w, h);
            } else {
                ctx.fillStyle = fx.color;
                ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
            }
            ctx.restore();
        }

        // Draw obstacles
        obstacles.forEach(obstacle => obstacle.draw());

        // Draw earthen beasts (wild ones)
        earthenBeasts.forEach(beast => beast.draw());

        // 绘制玩家：甜品飞船 + 驾驶舱内的白色糯米团（三态表情，合成见 drawPlayer）
        drawPlayer();


        // Draw earthen beast partner if visible
        //（守护技能=默认形象；三色伙伴=对应颜色图，图未就绪时用对应颜色色块；
        //  alpha 用于到期离场前最后 0.8 秒的整体平滑淡出）
        if (earthenBeastPartner.isVisible) {
            const p = earthenBeastPartner;
            const pimg = p.variant ? beastVariantImages[p.variant] : p.image;
            ctx.globalAlpha = p.alpha;
            if (imgReady(pimg)) {
                ctx.drawImage(pimg, p.x, p.y, p.width, p.height);
            } else {
                ctx.fillStyle = p.color;
                ctx.fillRect(p.x, p.y, p.width, p.height);
            }
            ctx.globalAlpha = 1;
        }

        // 绿色大地兽：被吸附的甜品与玩家之间画流动的绿色光点
        if (earthenBeastPartner.variant === 'green') {
            collectibles.forEach((c) => {
                if (player.collidesWith(c) || !isWithinAttractRange(c)) return;
                for (let j = 0; j < 2; j++) {
                    const t = (Date.now() / 300 + j * 0.5 + c.y * 0.013) % 1;
                    const gx = c.x + c.width / 2 + (player.x + player.width / 2 - c.x - c.width / 2) * t;
                    const gy = c.y + c.height / 2 + (player.y + player.height / 2 - c.y - c.height / 2) * t;
                    ctx.fillStyle = 'rgba(129,199,132,0.85)';
                    ctx.beginPath();
                    ctx.arc(gx, gy, 2.5, 0, Math.PI * 2);
                    ctx.fill();
                }
            });
        }

        // Draw particles（金色星星 / 紫色泡泡破裂 / 绿色光点）
        drawParticles();

        // Draw shield effect（紫色布丁护盾 = 玻璃泡泡 PNG：35% 透明 + 1.5s 呼吸 +
        // 淡紫流光弧 + 内部星屑；守护兽技能已移除，黄色护盾不再出现；
        // 素材未就绪时函数内部自动退回程序描边占位）
        drawShieldBubble();
    };

    const gameLoop = () => {
        if (!isRunning) return;

        // 暂停 / 新手引导期间冻结一切更新（玩家、障碍、甜品、粒子），
        // 仍绘制静止画面；恢复后从原状态继续
        if (!isPaused) update();
        draw();
        animationFrameId = requestAnimationFrame(gameLoop);
    };

    // 这些按键的默认行为是滚动页面，游戏进行中要拦截，交给角色控制
    const GAME_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '];

    const handleKeyDown = (e) => {
        if (GAME_KEYS.includes(e.key)) e.preventDefault();
        // ESC 切换暂停（新手引导显示期间不响应，避免引导没看完就恢复游戏）
        if (e.key === 'Escape') {
            if (!tutorialActive) togglePause();
            return;
        }
        if (isPaused) return; // 暂停时忽略移动与技能按键
        keys[e.key] = true;
        setPlayerDirection();

        // 技能按键：Space / Q = 甜品风暴（唯一主动技能）
        // 守护兽技能已移除，大地兽只是陪伴伙伴；长按不重复触发（e.repeat 过滤）
        if ((e.key === ' ' || e.key === 'q' || e.key === 'Q') && !e.repeat) {
            useSkill('dessertStorm');
        }
    };

    const handleKeyUp = (e) => {
        keys[e.key] = false;
        setPlayerDirection();
    };

    // 窗口失焦（比如切到别的窗口）时清空按键状态，
    // 防止"按键卡住"导致角色一直朝一个方向移动
    const handleWindowBlur = () => {
        Object.keys(keys).forEach((key) => { keys[key] = false; });
        setPlayerDirection();
    };

    const setPlayerDirection = () => {
        player.dx = 0;
        player.dy = 0;

        if (keys['ArrowLeft'] || keys['a'] || keys['A']) {
            player.dx = -player.speed;
        }
        if (keys['ArrowRight'] || keys['d'] || keys['D']) {
            player.dx = player.speed;
        }
        if (keys['ArrowUp'] || keys['w'] || keys['W']) {
            player.dy = -player.speed;
        }
        if (keys['ArrowDown'] || keys['s'] || keys['S']) {
            player.dy = player.speed;
        }

        // 记录朝向：伙伴跟在朝向反侧的身后
        if (player.dx > 0) player.facing = 'right';
        else if (player.dx < 0) player.facing = 'left';
    };

    // Mobile touch controls
    const handleTouchStart = (e) => {
        e.preventDefault(); // Prevent scrolling
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    };

    const handleTouchMove = (e) => {
        e.preventDefault();
        if (!touchStartX || !touchStartY) return;

        const touchEndX = e.touches[0].clientX;
        const touchEndY = e.touches[0].clientY;

        const dx = touchEndX - touchStartX;
        const dy = touchEndY - touchStartY;

        // Simple movement based on touch drag
        player.dx = dx * 0.1; // Scale factor
        player.dy = dy * 0.1;
        // 触屏拖动也更新朝向
        if (dx > 2) player.facing = 'right';
        else if (dx < -2) player.facing = 'left';

        // Reset for next movement segment
        touchStartX = touchEndX;
        touchStartY = touchEndY;
    };

    const handleTouchEnd = () => {
        touchStartX = 0;
        touchStartY = 0;
        player.dx = 0;
        player.dy = 0;
    };

    const createVirtualButtons = () => {
        // Clear existing virtual buttons
        Object.values(virtualButtons).forEach(btn => btn.remove());
        virtualButtons = {};

        const gameplayScreen = document.getElementById('gameplay-screen');

        // 甜品风暴（唯一主动技能）小圆汽水杯按钮
        // （守护兽按钮已移除：大地兽是陪伴伙伴，不是可释放的技能）
        // 位置按设备分支（内联样式优先级高于 CSS，PC 端规则完全不变）：
        //   PC：底部居中（历史位置，零改动）；
        //   移动端：右侧竖排操作区——D-pad 正上方，与 D-pad 同右边距
        //   （safe-area-inset-right 避让刘海），留 14px 间距防误触；bottom 用与
        //   D-pad 完全相同的 clamp 公式推算其总高（3 键 + 2×6px 间距），
        //   任何视口下都精确叠在 D-pad 上方、不超出屏幕。
        //   本轮：随 D-pad 同步上移 60px 避让 "Powered by Netlify" 标识；
        //   尺寸 76→60px（≈79%），文字字号同步微缩、仍易点击（仅移动端，
        //   PC 分支与公共 CSS 均不变）
        const skill2Btn = document.createElement('button');
        skill2Btn.id = 'virtual-skill2-button';
        skill2Btn.textContent = '甜品风暴 0%';
        skill2Btn.classList.add('virtual-skill-button');
        skill2Btn.style.cssText = IS_MOBILE
            ? // 移动端：右侧竖排（D-pad 上方 14px，整体随 D-pad 上移 60px）
              'position: absolute; right: max(14px, env(safe-area-inset-right, 0px));' +
              'bottom: calc(max(14px, env(safe-area-inset-bottom, 0px)) + 60px + 3 * clamp(48px, 7.2vh, 58px) + 12px + 14px);' +
              'width: 60px; height: 60px; margin: 0; font-size: clamp(0.6em, 1.7vw, 0.68em);'
            : // PC 底部居中：left/right 双 0 + margin auto 居中，不用 transform（避免与按下缩放动画冲突）
              'position: absolute; bottom: max(20px, env(safe-area-inset-bottom, 0px)); left: 0; right: 0; margin: 0 auto;';
        skill2Btn.addEventListener('click', () => useSkill('dessertStorm'));
        gameplayScreen.appendChild(skill2Btn);
        virtualButtons.skill2 = skill2Btn;

        // ============================================================
        // 移动端虚拟方向键（右下角十字键）：半透明奶白玻璃风。
        // 复用键盘控制通道（keys 表 + setPlayerDirection）：
        // 长按持续移动、松开立即停止，与键盘 / 画布拖动操作完全共存；
        // 仅移动端创建（IS_MOBILE），PC 端不生成、零影响。
        // ============================================================
        if (IS_MOBILE) {
            const dpad = document.createElement('div');
            dpad.id = 'virtual-dpad';
            const DPAD_BTNS = [
                { area: 'up', key: 'ArrowUp', label: '↑', name: '上' },
                { area: 'left', key: 'ArrowLeft', label: '←', name: '左' },
                { area: 'right', key: 'ArrowRight', label: '→', name: '右' },
                { area: 'down', key: 'ArrowDown', label: '↓', name: '下' }
            ];
            DPAD_BTNS.forEach(({ area, key, label, name }) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'dpad-btn';
                btn.style.gridArea = area;
                btn.textContent = label;
                btn.setAttribute('aria-label', '向' + name + '移动');
                // 按下：等效按住键盘方向键；松开/被打断：等效松键，立即停止
                const press = (e) => {
                    if (e.cancelable) e.preventDefault(); // 防长按选中/呼出菜单/触发滚动
                    btn.classList.add('pressed');
                    keys[key] = true;
                    setPlayerDirection();
                };
                const release = (e) => {
                    if (e && e.cancelable) e.preventDefault();
                    btn.classList.remove('pressed');
                    keys[key] = false;
                    setPlayerDirection();
                };
                // 触摸事件以"按下时的手指"为准：滑出按钮也会收到 touchend，不会卡键
                btn.addEventListener('touchstart', press, { passive: false });
                btn.addEventListener('touchend', release, { passive: false });
                btn.addEventListener('touchcancel', release, { passive: false });
                // 鼠标按下/抬起同样生效（桌面调试用；触摸端 preventDefault 已屏蔽合成鼠标事件）
                btn.addEventListener('mousedown', press);
                btn.addEventListener('mouseup', release);
                btn.addEventListener('mouseleave', (e) => { if (keys[key]) release(e); });
                dpad.appendChild(btn);
            });
            gameplayScreen.appendChild(dpad);
            virtualButtons.dpad = dpad;
        }

        updateStormButton();
    };

    // ============================================================
    // 大地兽陪伴倒计时 UI（#beast-timer）：透明薄荷汽水气泡计时器。
    // 圆环进度 = 剩余陪伴比例（--p 百分比），中心显示剩余秒数；
    // 最后 2 秒转入 .ending 柔和渐弱态（气泡减少、光效变弱，不闪烁）。
    // 每帧由 update() 调用 updateBeastTimerUI；显隐由伙伴激活/离场驱动。
    // ============================================================
    const beastTimerEl = document.getElementById('beast-timer');
    let beastTimerHideTimer = 0;
    const showBeastTimer = () => {
        if (!beastTimerEl) return;
        clearTimeout(beastTimerHideTimer);
        beastTimerEl.classList.remove('bye', 'ending');
        beastTimerEl.hidden = false;
        beastTimerEl.style.setProperty('--p', '100');
        const sec = beastTimerEl.querySelector('.beast-timer-sec');
        if (sec) sec.textContent = String(Math.ceil(PARTNER_MAX_MS / 1000));
    };
    const hideBeastTimer = () => {
        if (!beastTimerEl || beastTimerEl.hidden) return;
        beastTimerEl.classList.add('bye'); // 先淡出，再真正隐藏（平滑消失）
        clearTimeout(beastTimerHideTimer);
        beastTimerHideTimer = setTimeout(() => {
            beastTimerEl.hidden = true;
            beastTimerEl.classList.remove('bye', 'ending');
            // 清掉残留进度/秒数（下次显示由 showBeastTimer 重置为满值）
            beastTimerEl.style.setProperty('--p', '100');
            const sec = beastTimerEl.querySelector('.beast-timer-sec');
            if (sec) sec.textContent = String(Math.ceil(PARTNER_MAX_MS / 1000));
        }, 300);
    };
    const updateBeastTimerUI = (remainingMs) => {
        if (!beastTimerEl || beastTimerEl.hidden) return;
        const ratio = Math.max(0, Math.min(1, remainingMs / PARTNER_MAX_MS));
        beastTimerEl.style.setProperty('--p', String(Math.round(ratio * 100)));
        beastTimerEl.classList.toggle('ending', remainingMs <= 2000);
        const sec = beastTimerEl.querySelector('.beast-timer-sec');
        if (sec) sec.textContent = String(Math.max(1, Math.ceil(remainingMs / 1000)));
    };

    // 甜品风暴按钮状态同步：能量百分比 + 充满时的可释放高亮
    const updateStormButton = () => {
        const btn = virtualButtons.skill2;
        if (!btn) return;
        // 风暴进行中：按钮切换为"风暴中！"流光状态
        if (stormState.active) {
            btn.textContent = '风暴中！';
            btn.classList.add('storm-active');
            btn.classList.remove('storm-ready');
            return;
        }
        btn.classList.remove('storm-active');
        const pct = Math.round((player.stormEnergy / SKILLS.dessertStorm.energyMax) * 100);
        btn.textContent = `甜品风暴 ${pct}%`;
        btn.classList.toggle('storm-ready', pct >= 100);
    };

    // 按键触发时同步按钮按压动画（与鼠标点击手感一致）
    const flashStormButton = () => {
        const btn = virtualButtons.skill2;
        if (!btn) return;
        btn.classList.remove('storm-press');
        void btn.offsetWidth; // 强制重排以重启动画
        btn.classList.add('storm-press');
        setTimeout(() => btn.classList.remove('storm-press'), 260);
    };

    // 通用游戏内提示浮层：薄荷玻璃胶囊，自动淡出，不遮挡不刷屏
    const showGameToast = (id, text, duration = 2400) => {
        const container = document.getElementById('game-container');
        if (!container) return;
        let toast = document.getElementById(id);
        if (!toast) {
            toast = document.createElement('div');
            toast.id = id;
            toast.className = 'game-toast';
            container.appendChild(toast);
        }
        toast.textContent = text;
        toast.classList.remove('show');
        void toast.offsetWidth; // 强制重排以重启动画
        toast.classList.add('show');
        clearTimeout(toast._hideTimer);
        toast._hideTimer = setTimeout(() => toast.classList.remove('show'), duration);
    };

    // 甜品风暴就绪提示：能量积满时显示操作说明（触摸设备无键盘，只提示点按钮）
    const showStormReadyHint = () => {
        showGameToast('storm-ready-toast',
            IS_TOUCH ? '甜品风暴已准备！点击按钮释放' : '甜品风暴已准备！按 Space 键或点击按钮释放');
    };

    // 图鉴新发现提示：首次获得稀有/特殊甜品时弹出
    const showNewDiscoveryToast = (entry) => {
        const text = entry.rarity === 'legendary'
            ? `隐藏甜品现身：${entry.name}！`
            : `图鉴新发现：${entry.name}！`;
        showGameToast('dessert-discovery-toast', text, 2600);
    };

    // ============================================================
    // 甜品风暴状态 = 5 秒"薄荷甜品魔法时间"（不是攻击技能）：
    // 现有障碍物温柔转化为普通甜品、暂停新障碍生成、
    // 甜品高频涌出（普通为主，稀有仍走原概率）、
    // 薄荷能量波 + 梦幻滤镜 + 气泡上升，结束自动恢复原节奏。
    // ============================================================
    // 风暴期间的环境粒子：薄荷气泡从画布底部缓缓上升（梦幻氛围）
    const spawnStormAmbient = () => {
        particles.push({
            x: Math.random() * canvas.width,
            y: canvas.height + 6,
            vx: (Math.random() - 0.5) * 0.4,
            vy: -(0.5 + Math.random() * 0.8),
            life: 1, decay: 0.008 + Math.random() * 0.004,
            size: 1.5 + Math.random() * 2.5,
            kind: 'burst',
            color: ['#a5e5d8', '#d0f4ea', '#ffffff'][Math.floor(Math.random() * 3)]
        });
    };

    const startStorm = () => {
        stormState.active = true;
        stormState.timeLeft = SKILLS.dessertStorm.durationMs;

        // 当前出现的障碍物 → 普通甜品（温柔转化，位置不变）
        for (let i = obstacles.length - 1; i >= 0; i--) {
            const obstacle = obstacles[i];
            const tierTypes = COLLECTIBLE_RARITY_POOL.common;
            const type = tierTypes[Math.floor(Math.random() * tierTypes.length)];
            const size = Math.round(COLLECTIBLE_BASE_SIZE * COLLECTIBLE_SCALE_BY_TIER.common); // 与野生收集物同缩放
            collectibles.push(new GameObject(
                obstacle.x, obstacle.y, size, size, type.color, type, ASSETS.collectible(type.name)
            ));
            obstacles.splice(i, 1);
        }

        // 风暴节奏：停新障碍、甜品雨开启（setSpawnIntervals 感知风暴状态）
        setSpawnIntervals();

        // 薄荷甜品能量波：扩散圆环 + 星星水珠飞舞（柔和梦幻；移动端减半保帧率）
        const ringN = IS_TOUCH ? 15 : 30;
        const burstN = IS_TOUCH ? 7 : 14;
        const px = player.x + player.width / 2;
        const py = player.y + player.height / 2;
        for (let i = 0; i < ringN; i++) {
            const a = (Math.PI * 2 * i) / ringN;
            particles.push({
                x: px, y: py,
                vx: Math.cos(a) * 3.2, vy: Math.sin(a) * 3.2,
                life: 1, decay: 0.02, size: 3, kind: 'burst', color: '#a5e5d8'
            });
        }
        for (let i = 0; i < burstN; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 1 + Math.random() * 2;
            particles.push({
                x: px, y: py,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.8,
                life: 1, decay: 0.015 + Math.random() * 0.01,
                size: 2.5 + Math.random() * 2,
                kind: i % 3 === 0 ? 'storm-star' : 'burst',
                color: ['#a5e5d8', '#d0f4ea', '#f8bbd0'][i % 3]
            });
        }

        // 屏幕轻微梦幻效果：画布柔光呼吸（5 秒后随风暴结束移除）
        canvas.classList.add('mint-magic');

        // 释放瞬间：容器轻微甜品气息晃动（保留既有反馈）
        const container = document.getElementById('game-container');
        if (container) {
            container.classList.remove('sweet-surge');
            void container.offsetWidth; // 强制重排以重启动画
            container.classList.add('sweet-surge');
            setTimeout(() => container.classList.remove('sweet-surge'), 600);
        }

        updateStormButton();
        console.log("Dessert Storm activated! 5s mint magic time.");
    };

    const endStorm = () => {
        stormState.active = false;
        stormState.timeLeft = 0;
        canvas.classList.remove('mint-magic');
        setSpawnIntervals(); // 恢复障碍生成、停止甜品雨
        updateStormButton();
        console.log("Dessert Storm ended.");
    };

    // 收集甜品时积累风暴值（直接碰撞与绿色伙伴吸附两条路径都会经过 spawnCollectEffect）
    const gainStormEnergy = (amount) => {
        const before = player.stormEnergy;
        if (before >= SKILLS.dessertStorm.energyMax) return;
        player.stormEnergy = Math.min(SKILLS.dessertStorm.energyMax, player.stormEnergy + amount);
        updateStormButton();
        // 能量刚刚积满：提示释放方式（每次充满提示一次，未释放不重复打扰）
        if (before < SKILLS.dessertStorm.energyMax &&
            player.stormEnergy >= SKILLS.dessertStorm.energyMax) {
            showStormReadyHint();
        }
    };

    // 画布尺寸自适应（不再写死像素）：
    // 从父容器的实际内边距、间距、计分栏高度动态计算可用空间，
    // 并扣除画布自带边框（2px×2），保证画布完整落在界面内不溢出。
    // 窗口大小变化（包括手机横竖屏切换）时都会重新计算。
    const resizeCanvas = () => {
        const parent = canvas.parentElement;
        const style = getComputedStyle(parent);
        const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const gap = parseFloat(style.rowGap) || 0;
        const statsBar = document.getElementById('game-stats');
        const statsH = statsBar ? statsBar.getBoundingClientRect().height : 0;
        // 高度多留 8px 安全余量：防止"刚好占满"时因亚像素舍入多出 1px
        // 触发竖向滚动条，滚动条又会挤压宽度导致横向溢出的连锁问题
        canvas.width = Math.max(320, Math.floor(parent.clientWidth - padX) - 4);
        canvas.height = Math.max(240, Math.floor(parent.clientHeight - padY - gap - statsH) - 8);
        // 玩家当前位置同步限制在新的画布范围内，防止卡在边界外
        player.x = Math.min(Math.max(player.x, 0), canvas.width - player.width);
        player.y = Math.min(Math.max(player.y, 0), canvas.height - player.height);
    };

    // ============================================================
    // 暂停系统：ESC 或暂停按钮进入暂停。
    // 暂停 = 冻结 update()（玩家移动/障碍/甜品/粒子全部停止）+
    // 清除生成定时器（甜品/障碍/大地兽停止生成）；恢复时重建定时器继续。
    // ============================================================
    const setSpawnIntervals = () => {
        clearInterval(collectibleSpawnInterval);
        clearInterval(obstacleSpawnInterval);
        clearInterval(earthenBeastSpawnInterval);
        clearInterval(stormSpawnInterval);
        collectibleSpawnInterval = setInterval(spawnCollectible, currentLevel.collectibleSpawnRate);
        // 甜品风暴期间：暂停新障碍生成，甜品高频涌出（走动态掉落概率）
        if (stormState.active) {
            // 移动端甜品雨间隔放宽到 380ms（视觉依旧密集，元素总量更可控）
            stormSpawnInterval = setInterval(spawnCollectible, IS_TOUCH ? 380 : STORM_DESSERT_SPAWN_MS);
        } else {
            // 动态难度：障碍生成间隔 = 基础间隔 / 密度倍率（随积分平滑加密）
            difficulty.lastSpawnMs = getObstacleSpawnMs();
            obstacleSpawnInterval = setInterval(spawnObstacle, difficulty.lastSpawnMs);
        }
        earthenBeastSpawnInterval = setInterval(spawnEarthenBeast, currentLevel.earthenBeastSpawnRate);
    };
    const clearSpawnIntervals = () => {
        clearInterval(collectibleSpawnInterval);
        clearInterval(obstacleSpawnInterval);
        clearInterval(earthenBeastSpawnInterval);
        clearInterval(stormSpawnInterval);
    };

    const pauseOverlay = document.getElementById('pause-overlay');
    const tutorialOverlay = document.getElementById('tutorial-overlay');
    const showPauseOverlay = () => { if (pauseOverlay) pauseOverlay.classList.add('show'); };
    const hidePauseOverlay = () => { if (pauseOverlay) pauseOverlay.classList.remove('show'); };

    const pauseGame = () => {
        if (!isRunning || isPaused || tutorialActive) return;
        isPaused = true;
        clearSpawnIntervals();
        showPauseOverlay();
        console.log("Game Paused.");
    };
    const resumeGame = () => {
        if (!isPaused || tutorialActive) return;
        isPaused = false;
        hidePauseOverlay();
        setSpawnIntervals();
        console.log("Game Resumed.");
    };
    const togglePause = () => {
        if (isPaused) resumeGame(); else pauseGame();
    };

    // 新手引导：第一次进入游戏时显示（复用暂停机制冻结游戏），看过一次后不再出现
    const showTutorial = () => {
        tutorialActive = true;
        isPaused = true;
        clearSpawnIntervals();
        if (tutorialOverlay) tutorialOverlay.classList.add('show');
        console.log("Tutorial shown.");
    };
    const dismissTutorial = () => {
        if (!tutorialActive) return;
        tutorialActive = false;
        try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch (e) { /* 忽略 */ }
        if (tutorialOverlay) tutorialOverlay.classList.remove('show');
        isPaused = false;
        setSpawnIntervals(); // 恢复甜品/障碍/大地兽生成
        console.log("Tutorial dismissed.");
    };

    // ============================================================
    // 移动端强制横屏：方向状态机（多信号兜底，兼容微信 X5 / 国产浏览器）。
    // 不再依赖 matchMedia('orientation') 的 change 事件（微信旋转后经常不触发、
    // 部分内核媒体查询评估滞后），改为直接实测 innerWidth/innerHeight 宽高：
    //   驱动源 = resize + orientationchange(延迟重读) + visualViewport.resize
    //            + 500ms 低频轮询（部分浏览器旋转后不发任何事件）
    // body.is-portrait 类供 CSS 控制提示层显隐（媒体查询仅作无 JS 兜底）；
    // 竖屏：对局自动冻结（横屏提示层全覆盖）；横屏：自动恢复。
    // 同时维护 --app-height（真实可视高度 px），供 CSS 兼容不支持 dvh 的内核。
    // 仅移动端生效（IS_MOBILE），PC 端零影响。
    // ============================================================
    let portraitPaused = false; // 因竖屏触发的暂停（区别于玩家手动暂停）
    let lastPortrait = null;    // 上次判定的方向（null = 未初始化）
    let lastAppHeight = 0;      // 上次写入的真实可视高度（变化守卫，避免无谓重排）
    // 真实可视高度（地址栏/工具栏动态收展时同步更新），写入 CSS 变量 --app-height。
    // h>0 守卫：部分内核（微信 X5 等）初始化瞬间 innerHeight/visualViewport.height
    // 可能为 0，写入 0px 会让 game-container 高度归零、画面整块消失（微信白屏的来源之一）
    const updateAppHeight = () => {
        const vv = window.visualViewport;
        const h = Math.round((vv && vv.height) ? vv.height : window.innerHeight);
        if (!(h > 0) || h === lastAppHeight) return;
        lastAppHeight = h;
        document.documentElement.style.setProperty('--app-height', h + 'px');
        // 容器高度实际变化时重算游戏画布（仅对局界面可见时，避免菜单期无谓重置）
        const gameplayScreen = document.getElementById('gameplay-screen');
        if (gameplayScreen && gameplayScreen.classList.contains('active')) resizeCanvas();
    };
    const applyOrientationState = () => {
        const portrait = window.innerHeight > window.innerWidth;
        document.body.classList.toggle('is-portrait', portrait);
        updateAppHeight();
        if (portrait === lastPortrait) return; // 方向未变化：不重复处理
        lastPortrait = portrait;
        if (portrait) {
            // 转到竖屏：进行中的对局自动冻结（玩家手动暂停/新手引导期间不动）
            if (isRunning && !isPaused && !tutorialActive) {
                pauseGame();
                hidePauseOverlay(); // 暂停浮层不显示，由横屏提示层全屏覆盖
                portraitPaused = true;
            }
        } else if (portraitPaused) {
            // 回到横屏：自动恢复对局（"横屏后自动进入游戏"）
            portraitPaused = false;
            resumeGame();
        }
    };
    const watchOrientation = () => {
        if (!IS_MOBILE) return;
        document.body.classList.add('is-mobile'); // CSS 据此显示横屏提示层与安全区样式
        applyOrientationState(); // 初次判定（页面刚打开即正确显示/隐藏提示层）
        window.addEventListener('resize', applyOrientationState);
        window.addEventListener('orientationchange', () => {
            // 旋转事件触发时视口尺寸可能尚未更新，延迟重读两次
            setTimeout(applyOrientationState, 120);
            setTimeout(applyOrientationState, 400);
        });
        if (window.visualViewport && window.visualViewport.addEventListener) {
            window.visualViewport.addEventListener('resize', applyOrientationState);
        }
        setInterval(applyOrientationState, 500); // 轮询兜底（微信等旋转不发事件的浏览器）
    };

    const init = () => {
        resizeCanvas();
        // 触摸设备：标记 body，CSS 据此显示手机端操作提示（.touch-only 行）
        if (IS_TOUCH) document.body.classList.add('is-touch');
        // 移动端：强制横屏监听（竖屏自动暂停 / 横屏自动恢复 + is-mobile 标记）
        watchOrientation();
        player.y = canvas.height / 2 - player.height / 2; // Center player vertically
        updateStatsDisplay(); // Set initial score and lives

        window.addEventListener('resize', () => {
            resizeCanvas();
        });

        // Load default character and outfit images initially
        loadCharacterAssets();

        // Mobile touch events
        canvas.addEventListener('touchstart', handleTouchStart, false);
        canvas.addEventListener('touchmove', handleTouchMove, false);
        canvas.addEventListener('touchend', handleTouchEnd, false);

        // Create virtual buttons for mobile
        createVirtualButtons();

        // 读取已达成成就（localStorage 持久化，跨局保留）
        loadAchievements();

        // 暂停浮层按钮：继续 / 重新开始 / 返回主菜单
        const resumeBtn = document.getElementById('resume-button');
        if (resumeBtn) resumeBtn.addEventListener('click', resumeGame);
        const restartPauseBtn = document.getElementById('restart-from-pause');
        if (restartPauseBtn) restartPauseBtn.addEventListener('click', () => {
            stop();  // 清理本局（定时器/监听/虚拟按钮/浮层）
            start(); // 完整重置并开始新一局
        });
        const homePauseBtn = document.getElementById('home-from-pause');
        if (homePauseBtn) homePauseBtn.addEventListener('click', () => {
            stop();
            GameManager.showScreen('mainMenu');
            console.log("Back to Main Menu from Pause");
        });
        // HUD 暂停按钮 + 新手引导"知道了"按钮
        const pauseBtn = document.getElementById('pause-button');
        if (pauseBtn) pauseBtn.addEventListener('click', pauseGame);
        const tutorialBtn = document.getElementById('tutorial-dismiss');
        if (tutorialBtn) tutorialBtn.addEventListener('click', dismissTutorial);

        console.log("Game initialized. Canvas size:", canvas.width, "x", canvas.height);
    };

    const start = () => {
        // 进入对局时按当前可视区域重算画布：全屏/地址栏收展可能发生在菜单期间
        // （「开始冒险」即申请全屏），那些 resize 发生时对局页未激活、不会重算，
        // 若不在此补算，画布会沿用旧尺寸导致超高溢出/过小留白
        resizeCanvas();
        if (!isRunning) {
            isRunning = true;
            isPaused = false;      // 新一局从非暂停状态开始
            tutorialActive = false;
            score = 0; // Reset score
            lives = 3; // Reset lives
            runDessertsCollected = 0; // 本局收集甜品计数清零（结算用）
            // 快照开局已发现甜品：结算时对比得出"新发现"列表
            discoveredAtRunStart = new Set(
                Object.values(DESSERT_DEX).filter((e) => e.discovered).map((e) => e.id)
            );
            updateStatsDisplay(); // Update display with reset values

            /* ========== 新一局完整重置（修复"第二局卡在地面只能左右移动"） ==========
               上一局结束时若还有按键按着（比如死亡瞬间正按住"下"），
               stop() 已移除键盘监听，对应的 keyup 永远收不到，
               keys 表里就残留 true；第二局角色会被持续推向那个方向，
               且按反方向键会被残留按键覆盖，看起来就是"卡死在地面"。
               这里把控制状态和所有计时状态一次性清零。 */
            Object.keys(keys).forEach((k) => { keys[k] = false; }); // 清空残留按键
            player.x = 50; // Reset player position
            player.y = canvas.height / 2 - player.height / 2; // Reset player position
            player.dx = 0; // Reset velocity
            player.dy = 0;
            player.isShielded = false; // Reset flight/buff states
            player.shieldEndTime = 0;
            player.shieldCharges = 0;
            player.isAutoCollecting = false;
            player.autoCollectEndTime = 0;
            player.isDashing = false;
            player.dashEndTime = 0;
            player.stormEnergy = 0;                // 甜品风暴值清零（新局重新积累）
            stormState.active = false;             // 风暴状态清零（魔法时间不跨局残留）
            stormState.timeLeft = 0;
            lastFrameTime = 0;                     // 帧时间基准复位（防止新局首帧 dt 异常）
            canvas.classList.remove('mint-magic'); // 确保梦幻滤镜不跨局残留
            updateStormButton();
            deactivateBeastPartner(); // 大地兽伙伴不跨局残留（能力/倒计时/淡出状态一并复位）
            player.facing = 'right';               // 朝向复位（伙伴回到默认左后方）
            player.faceState = 'normal';           // 表情复位：新局从正常态开始
            player.faceStateUntil = 0;
            player.popUntil = 0;                   // 收集反馈动画复位
            player.hitFlashUntil = 0;              // 受击闪烁复位
            particles.length = 0;                  // 清空上一局的粒子

            collectibles.length = 0; // Clear existing collectibles
            collectFx.length = 0; // Clear collection animations
            obstacles.length = 0; // Clear existing obstacles
            earthenBeasts.length = 0; // Clear existing wild earthen beasts

            // Load level-specific background
            const selectedLevelName = GameManager.getSelectedLevel();
            currentLevel = LEVELS[selectedLevelName];
            background.image.src = ASSETS.background(currentLevel.background);
            bgScroll = 0; // 背景滚动里程重置（新开局从素材起点推进）
            bgLastTime = 0; // 帧时间基准重置（防止新局首帧 dt 异常）

            // 动态难度/掉落：新一局从本关起点难度开始（每局重算，不继承上一局积分）
            recomputeDifficulty();
            resetDropState();

            // BGM：第一关沿用菜单的花园曲（同曲在播自动无缝跳过，进度不变）；
            // 第二关 1.5 秒 Crossfade 切换极光曲（从开头播放，无限循环）
            if (selectedLevelName === 'level2') AudioManager.play('aurora', 1500);
            else AudioManager.play('garden', 800);

            // 记录衣柜当前选择（新角色白色糯米团暂不绘制服饰叠层，数据保留作未来素材接口）
            player.currentOutfit = GameManager.getSelectedOutfit();

            // 甜品/障碍/大地兽生成定时器（暂停时会清掉，恢复/关闭引导时重建）
            setSpawnIntervals();

            document.addEventListener('keydown', handleKeyDown);
            document.addEventListener('keyup', handleKeyUp);
            window.addEventListener('blur', handleWindowBlur);

            createVirtualButtons(); // 每次开局都重建技能按钮（修复重开一局后按钮消失的问题）

            animationFrameId = requestAnimationFrame(gameLoop);

            // 第一次进入游戏：显示新手引导（只显示一次，期间游戏冻结）
            if (!tutorialSeen()) showTutorial();

            console.log(`Game Started with Outfit: ${GameManager.getSelectedOutfit()}, Character: ${GameManager.getSelectedCharacter()}, Level: ${selectedLevelName}`);
        }
    };

    const stop = () => {
        if (!isRunning) return; // Prevent stopping if not running
        isRunning = false;
        isPaused = false;       // 离开运行状态时清除暂停标记
        tutorialActive = false;
        portraitPaused = false; // 竖屏暂停标记一并复位（新局不受上一局横竖屏状态影响）
        hidePauseOverlay();
        if (tutorialOverlay) tutorialOverlay.classList.remove('show');
        cancelAnimationFrame(animationFrameId);
        clearInterval(collectibleSpawnInterval);
        clearInterval(obstacleSpawnInterval);
        clearInterval(earthenBeastSpawnInterval);
        clearInterval(stormSpawnInterval);
        // 风暴状态与梦幻滤镜一并复位（死亡/返回主菜单时魔法时间立即终止）
        stormState.active = false;
        stormState.timeLeft = 0;
        canvas.classList.remove('mint-magic');
        hideBeastTimer(); // 陪伴倒计时气泡随本局结束一并隐藏
        deactivateBeastPartner();
        AudioManager.stopTornado(); // 风暴云环境音随本局结束 0.3 秒淡出停止
        document.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('keyup', handleKeyUp);
        window.removeEventListener('blur', handleWindowBlur);
        // Remove virtual buttons when game stops
        Object.values(virtualButtons).forEach(btn => btn.remove());
        console.log("Game Stopped.");

        // ========== 结算界面数据填充（只读当前数据，不改变计分逻辑） ==========
        // 最高分：超过旧纪录则写入 localStorage 并标记"新纪录"
        const isNewRecord = score > getHighScore();
        if (isNewRecord && score > 0) saveHighScore(score);
        document.getElementById('final-score').textContent = score;
        document.getElementById('final-desserts').textContent = runDessertsCollected;
        // 新发现甜品：本局首次解锁图鉴的甜品名
        const newDiscoveries = Object.values(DESSERT_DEX)
            .filter((e) => e.discovered && !discoveredAtRunStart.has(e.id))
            .map((e) => e.name);
        document.getElementById('final-new-discoveries').textContent =
            newDiscoveries.length ? newDiscoveries.join('、') : '无';
        document.getElementById('final-high-score').textContent = getHighScore();
        document.getElementById('new-record').hidden = !(isNewRecord && score > 0);
        // 结束时再判定一次成就（覆盖"单局高分"类成就）
        checkAchievements();
    };

    const useSkill = (skillName) => {
        const skill = SKILLS[skillName];

        if (!skill) {
            console.error(`Skill ${skillName} not found.`);
            return;
        }

        // 仅游戏进行中可释放（菜单 / 结算界面按 Space 不误触）
        if (!isRunning) return;
        // 风暴进行中不能重复释放（等魔法时间结束后重新积累）
        if (stormState.active) return;

        // 甜品风暴是唯一主动技能：风暴值充满才能释放（能量制替代旧的冷却制）
        if (player.stormEnergy < skill.energyMax) {
            console.log('甜品风暴能量未充满，继续收集甜品吧！');
            return;
        }

        player.stormEnergy = 0; // 释放后清空风暴值
        updateStormButton();
        flashStormButton(); // 键盘触发时按钮同步按压动画（与点击表现一致）

        // 进入 5 秒薄荷甜品魔法时间：障碍转化 + 甜品雨 + 梦幻滤镜
        startStorm();
    };

    // ============================================================
    // 角色选择页视觉中心：糯米团 + 甜品飞船 合成展示
    // 复用 drawPlayer 的合成参数（飞船整图 + 糯米团入舱 + 玻璃罩前沿遮挡），
    // 素材原样绘制不重绘不改色；上下漂浮与 Q 弹缩放动画由 CSS 负责
    // 角色预览跟随衣柜当前选中系列（显示该系列 2 号 PNG，与衣柜首页代表图一致），
    // 进游戏后仍按原逻辑播放该系列 1→2→3 嘴型动画（互不影响）
    // ============================================================
    let characterHeroDraw = null; // 重绘入口：showScreen 进入确认角色页时调用（读最新选中皮肤）
    const initCharacterHero = () => {
        const heroBox = document.getElementById('char-hero');
        const heroCanvas = document.getElementById('char-hero-canvas');
        if (!heroBox || !heroCanvas) return;
        const hctx = heroCanvas.getContext('2d');
        const shipImg = new Image();
        shipImg.src = ASSETS.ship; // assets/dessert_ship.png

        const drawHero = () => {
            // 糯米团图 = 当前衣柜选中系列的 2 号 PNG（eating 帧）；
            // 皮肤图集未就绪/缺失时回退经典系列 2 号，加载完成后经 onload 自动补画
            const skinSet = skinStateImages[GameManager.getSelectedSkin()] || playerStateImages;
            const catImg = imgReady(skinSet.eating) ? skinSet.eating : playerStateImages.eating;
            if (!imgReady(shipImg) || !imgReady(catImg)) {
                // 大图仍在加载：挂重绘回调（重复赋值同一引用无副作用），到位后自动绘制。
                // ⚠ 皮肤图与回退图都要挂：只挂回退图时，回退图先就绪会画出经典兜底且不再
                // 重绘，皮肤图后到也无人触发 → 预览永久卡在经典回退图
                shipImg.onload = drawHero;
                skinSet.eating.onload = drawHero;
                catImg.onload = drawHero;
                return;
            }
            const W = heroCanvas.width, H = heroCanvas.height;
            hctx.clearRect(0, 0, W, H);
            const S = Math.min(W * 0.82, H * 0.96);
            const sx = (W - S) / 2, sy = (H - S) / 2;
            hctx.drawImage(shipImg, sx, sy, S, S);
            // 糯米团入舱：直径 0.30S，圆心对准玻璃面中心（参数与游戏内一致）
            const d = 0.30 * S;
            hctx.drawImage(catImg, sx + 0.4883 * S - d / 2, sy + 0.43 * S - d / 2, d, d);
            // 玻璃罩前沿遮挡：clip 椭圆下半带后重绘飞船（坐进舱内而非悬浮）
            hctx.save();
            hctx.beginPath();
            hctx.ellipse(sx + 0.4883 * S, sy + 0.5156 * S,
                         0.1641 * S, 0.0664 * S, 0,
                         Math.asin(0.3), Math.PI - Math.asin(0.3));
            hctx.closePath();
            hctx.clip();
            hctx.drawImage(shipImg, sx, sy, S, S);
            hctx.restore();
        };
        characterHeroDraw = drawHero;
        shipImg.onload = drawHero;
        drawHero(); // 图片已缓存时直接绘制

        // 点击糯米团：轻微 Q 弹缩放（95% → 105% → 100%，CSS 动画）
        // initCharacterHero 只在页面加载时执行一次 → 监听不会因重绘重复绑定
        heroBox.addEventListener('click', () => {
            heroCanvas.classList.remove('q-bounce');
            void heroCanvas.offsetWidth; // 强制重排以重启动画
            heroCanvas.classList.add('q-bounce');
        });
        heroCanvas.addEventListener('animationend', () => heroCanvas.classList.remove('q-bounce'));
    };

    // 自动化测试辅助钩子：暴露内部状态的只读引用与少量驱动入口，
    // 供测试页验证"跟随/能力/重置"，不影响正常玩法。
    window.__testHooks = {
        player,
        // 背景滚动状态诊断（只读）
        bgState: () => ({
            ready: imgReady(background.image),
            src: background.image.src,
            isLevel1: currentLevel === LEVELS.level1,
            scroll: bgScroll
        }),
        partner: earthenBeastPartner,
        collectibles,
        obstacles,
        earthenBeasts,
        particles,
        activateBeastCompanion,
        collectibleTypes: COLLECTIBLE_TYPES,
        collectFx,
        dessertDex: DESSERT_DEX,
        // 暂停 / 新手引导 / 成就 / 结算测试辅助（只读状态 + 少量驱动入口）
        pause: pauseGame,
        resume: resumeGame,
        dismissTutorial,
        achievements: ACHIEVEMENTS,
        checkAchievements,
        isTutorialActive: () => tutorialActive,
        getRunStats: () => ({
            score,
            desserts: runDessertsCollected,
            isPaused,
            tutorialActive,
            highScore: getHighScore()
        }),
        getState: () => ({ score, lives, isRunning, isPaused, variant: earthenBeastPartner.variant }),
        // 甜品风暴（唯一主动技能）测试辅助：只读能量 + 直接触发
        getStormEnergy: () => player.stormEnergy,
        gainStormEnergy,
        triggerStorm: () => useSkill('dessertStorm'),
        discoverDessert,
        // 甜品风暴状态（只读引用）：active / timeLeft（5 秒魔法时间倒计时）
        stormState,
        // 自动化环境 rAF 可能被挂起，无法验证"5 秒后自动结束"——
        // 提供直驱真实 endStorm 的入口（等价于倒计时归零那一帧执行的内容）
        forceEndStorm: () => { if (stormState.active) endStorm(); },
        // 甜品稀有度概率（只读）：权重 + 分组池
        rarityWeights: RARITY_WEIGHTS,
        rarityPool: COLLECTIBLE_RARITY_POOL,
        // 甜品玩偶陪伴倒计时（5 秒上限）测试辅助：状态只读 + 直驱入口
        partnerState: () => ({
            isVisible: earthenBeastPartner.isVisible,
            variant: earthenBeastPartner.variant,
            remaining: earthenBeastPartner.endTime ? earthenBeastPartner.endTime - Date.now() : 0,
            shieldRemaining: earthenBeastPartner.shieldUntil ? earthenBeastPartner.shieldUntil - Date.now() : 0,
            shieldCharges: player.shieldCharges,
            alpha: earthenBeastPartner.alpha
        }),
        // 自动化环境 rAF 可能被挂起（update 不跑）→ 直驱到期离场路径（等价倒计时归零帧）
        forcePartnerExpire: () => {
            if (earthenBeastPartner.isVisible) {
                earthenBeastPartner.endTime = Date.now() - 1;
                if (earthenBeastPartner.variant === 'purple' && player.shieldCharges > 0) {
                    enterShieldOnlyPhase(); // 紫色：与真实 update 相同，走"仅护盾"分支
                } else {
                    deactivateBeastPartner();
                }
            }
        },
        // 紫色护盾直驱：等价第 7 秒归零帧（护盾独立续航阶段到期）
        forceShieldExpire: () => {
            if (!earthenBeastPartner.isVisible && earthenBeastPartner.variant === 'purple' && player.shieldCharges > 0) {
                earthenBeastPartner.shieldUntil = Date.now() - 1;
                expireShield();
            }
        },
        // 倒计时 UI 渲染入口：绕过 rAF 直接驱动（验证圆环进度/.ending 态）
        updateBeastTimer: (ms) => updateBeastTimerUI(ms),
        beastTimerUI: () => {
            if (!beastTimerEl) return null;
            const sec = beastTimerEl.querySelector('.beast-timer-sec');
            return {
                hidden: beastTimerEl.hidden,
                ending: beastTimerEl.classList.contains('ending'),
                bye: beastTimerEl.classList.contains('bye'),
                p: beastTimerEl.style.getPropertyValue('--p'),
                sec: sec ? sec.textContent : ''
            };
        },
        isTouch: () => IS_TOUCH,
        // 主角三态表情测试辅助：只读状态 + 直接触发吃甜品动画
        faceState: () => ({ state: player.faceState, until: player.faceStateUntil }),
        triggerEat: () => {
            player.faceState = 'eating';
            player.faceStateUntil = Date.now() + 200;
        },
        // 自动化环境 rAF 可能挂起 → 把表情计时拨到已到期后直驱真实推进函数
        forceFaceTick: () => {
            if (player.faceState !== 'normal') player.faceStateUntil = Date.now() - 1;
            advanceFaceState();
        },
        // 玩家合成绘制验证：直驱一次真实 drawPlayer()（rAF 挂起环境下确定性验证用）
        drawPlayerOnce: () => { drawPlayer(); },
        // 玩家框只读坐标（验证合成几何/碰撞箱用）
        playerPos: () => ({ x: player.x, y: player.y, w: player.width, h: player.height }),
        // 玩家资源加载状态（验证飞船/三态图是否真正加载成功）
        playerAssetsReady: () => ({
            ship: imgReady(shipImage),
            normal: imgReady(playerStateImages.normal),
            eating: imgReady(playerStateImages.eating),
            happy: imgReady(playerStateImages.happy),
            // 三套皮肤系列各自的嘴型三帧图集就绪状态（衣柜换肤验证用）
            skins: Object.fromEntries(Object.entries(skinStateImages).map(([id, set]) => [
                id, { normal: imgReady(set.normal), eating: imgReady(set.eating), happy: imgReady(set.happy) }
            ]))
        }),
        // PNG 障碍物测试辅助：类型表只读（manifest 是否加载成功）+ 定向生成一种障碍物
        obstacleTypes: () => (OBSTACLE_TYPES || []).map((t) => ({ name: t.name, anim: t.anim, weight: t.weight, alpha: t.alpha || 1 })),
        // 冰晶雾底清理验证（只读）：统计 fogCanvas 边框 3px 环的非零 alpha 像素
        // borderNonzeroAlpha=0 为理想；少量且为蓝色 = 晶体本体自然延伸（正常）
        iceFogCheck: () => {
            const ice = (OBSTACLE_TYPES || []).find((t) => t.name === 'ice_crystal');
            if (!ice || !ice.fogCanvas) return { ok: false, reason: ice ? 'no-fog-canvas' : 'no-ice-type' };
            const c = ice.fogCanvas;
            const w = c.width, h = c.height;
            const d = c.getContext('2d').getImageData(0, 0, w, h).data;
            let bad = 0;
            const samples = [];
            const probe = (x, y) => {
                const p = (y * w + x) * 4;
                if (d[p + 3] > 0) {
                    bad++;
                    if (samples.length < 4) samples.push([x, y, d[p], d[p + 1], d[p + 2], d[p + 3]]);
                }
            };
            for (let i = 0; i < w; i++) {
                probe(i, 0); probe(i, 1); probe(i, 2);
                probe(i, h - 1); probe(i, h - 2); probe(i, h - 3);
            }
            for (let j = 0; j < h; j++) {
                probe(0, j); probe(1, j); probe(2, j);
                probe(w - 1, j); probe(w - 2, j); probe(w - 3, j);
            }
            return { ok: true, w, h, borderNonzeroAlpha: bad, samples };
        },
        // BGM 只读状态（曲目/音量/播放/进度），供自动化验证
        bgmState: () => AudioManager.debugState(),
        // 音频全量只读状态（BGM + 音效池 + 风暴云环境音）
        audioState: () => AudioManager.debugState(),
        spawnObstacleOfType: (name) => {
            const type = (OBSTACLE_TYPES || []).find((t) => t.name === name);
            if (!type) return null;
            const y = findSpawnY(OBSTACLE_SIZE);
            if (y === null) return null;
            // 直接生成在画面内右侧，便于立即观察动画与碰撞
            const o = new Obstacle(canvas.width - 90, y, OBSTACLE_SIZE, type);
            obstacles.push(o);
            return o.type.name;
        },
        // 真实生成路径直驱（验证权重抽取 / 风暴云同屏上限等自然生成规则）
        naturalSpawnObstacle: () => spawnObstacle(),
        // 动态难度测试辅助（只读）：当前生效倍率 + 指定积分下的模拟倍率（不改真实积分）
        difficultyState: () => ({
            tier: difficulty.tierName,
            tierSpeedMul: difficulty.tierSpeedMul,
            hiddenSpeedBonus: difficulty.hiddenSpeedBonus,
            densityMul: difficulty.densityMul,
            cloudAgilityMul: difficulty.cloudAgilityMul,
            iceBias: difficulty.iceBias,
            obstacleSpawnMs: getObstacleSpawnMs(),
            normalSpeed: 2 * getObstacleSpeedMul({ name: 'storm_cloud_sheet' }),
            iceSpeed: 2 * getObstacleSpeedMul({ name: 'ice_crystal' })
        }),
        difficultyAt: (s) => {
            const levelKey = GameManager.getSelectedLevel() || 'level1';
            const tiers = DIFFICULTY_TIERS_BY_LEVEL[levelKey] || DIFFICULTY_TIERS_BY_LEVEL.level1;
            let tier = tiers[0];
            for (const t of tiers) if (s >= t.min) tier = t;
            const sb = Math.floor(s / 100) * HIDDEN_GROWTH.speedPer100;
            const db = Math.floor(s / 100) * HIDDEN_GROWTH.densityPer100;
            const cb = Math.floor(s / 200) * HIDDEN_GROWTH.cloudPer200;
            return {
                tier: tier.name,
                speedMul: tier.speedMul * (1 + sb),
                densityMul: tier.densityMul * (1 + db),
                cloudAgilityMul: tier.cloudAgilityMul * (1 + cb),
                iceSpeedMul: tier.speedMul * (1 + Math.min(sb, HIDDEN_GROWTH.iceSpeedMaxBonus))
            };
        },
        // 动态掉落测试辅助（只读）：约束计数状态 + 立即重置（新一局等价）
        dropState: () => ({ ...dropState }),
        resetDropState: () => resetDropState(),
        // 本地存档测试辅助：立即写盘（绕过防抖）+ 读取原始存档 JSON
        saveProfileNow: () => { clearTimeout(saveDebounceTimer); saveProfile(); },
        readSave: () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return null; } }
    };

    return {
        init, start, stop, useSkill,
        // 角色选择页视觉中心合成绘制（糯米团 + 飞船）
        initCharacterHero,
        // 确认角色页重绘：进入页面时调用，预览跟随衣柜当前选中系列的 2 号 PNG
        redrawCharacterHero: () => { if (characterHeroDraw) characterHeroDraw(); },
        // 图鉴 UI 专用只读访问器：仅暴露数据引用，收集逻辑保持原样
        getDessertDex: () => DESSERT_DEX,
        getCollectibleTypes: () => COLLECTIBLE_TYPES,
        getCollectibleImagePath: (name) => ASSETS.collectible(name),
        // 大地兽伙伴信息界面只读访问器 + 成就/最高分数据
        getEarthenBeastTypes: () => EARTHEN_BEAST_TYPES,
        getEarthenBeastImagePath: (name) => ASSETS.beast(name),
        getAchievements: () => ACHIEVEMENTS,
        getHighScore,
        // 图鉴收藏目标常量（发现+收藏双系统 UI 用）
        getCollectGoal: () => COLLECT_GOAL,
        // 衣柜系统只读访问器：皮肤系列解锁判断与收集进度（GameManager 渲染卡片用）
        isSeriesUnlocked,
        getSkinProgress
    };
})();

// 甜品图鉴 UI：只读取 DESSERT_DEX 数据做展示，不做任何数据写入。
// 区域与卡片全部按数据自动生成：按 rarity 分成 普通/稀有/传说 三个区域，
// 每次打开界面时重新渲染，保证"已发现"状态始终与收集数据一致。
const DessertDexUI = (() => {
    // 分区顺序：common → rare → legendary；数据里出现未知稀有度时自动追加到末尾
    const RARITY_ORDER = ['common', 'rare', 'legendary'];
    const RARITY_LABELS = {
        common: { section: '普通甜品', badge: '普通', cls: 'rarity-common' },
        rare: { section: '稀有甜品', badge: '稀有', cls: 'rarity-rare' },
        legendary: { section: '传说甜品', badge: '传说', cls: 'rarity-legendary' }
    };

    // 生成单张甜品卡片：图片 / 名称 / 稀有度 / 简介 / 已发现状态
    const buildCard = (entry, typeInfo) => {
        const card = document.createElement('div');
        card.className = entry.discovered ? 'dex-card discovered' : 'dex-card undiscovered';
        card.dataset.id = entry.id; // 便于测试定位与后续详情扩展

        // 图片：未发现显示"？"；已发现显示素材图，素材缺失时退回甜品本色圆点
        const imgSlot = document.createElement('div');
        imgSlot.className = 'dex-img';
        if (entry.discovered) {
            const dot = document.createElement('div');
            dot.className = 'dex-color-dot';
            dot.style.background = typeInfo ? typeInfo.color : '#cccccc';
            imgSlot.appendChild(dot);
            const img = new Image();
            img.src = Game.getCollectibleImagePath(entry.id);
            img.alt = entry.name;
            img.onerror = () => img.remove(); // 素材未生成时自动保留色块圆点
            imgSlot.appendChild(img);
        } else {
            imgSlot.textContent = '？';
        }

        const nameEl = document.createElement('div');
        nameEl.className = 'dex-name';
        nameEl.textContent = entry.name;

        // 稀有度 + 收集状态徽章（同一行显示）
        const badges = document.createElement('div');
        badges.className = 'dex-badges';

        const rarity = RARITY_LABELS[entry.rarity];
        const rarityEl = document.createElement('div');
        rarityEl.className = 'dex-rarity ' + (rarity ? rarity.cls : 'rarity-locked');
        rarityEl.textContent = rarity ? rarity.badge : entry.rarity; // 未知稀有度直接显示原值
        badges.appendChild(rarityEl);

        const statusEl = document.createElement('div');
        statusEl.className = 'dex-status ' + (entry.discovered ? 'status-found' : 'status-locked');
        statusEl.textContent = entry.discovered ? '已发现' : '未发现';
        badges.appendChild(statusEl);

        // 收藏数量行（发现 + 收藏 双系统）：已发现时显示 收藏：X / 目标数
        let countEl = null;
        if (entry.discovered) {
            countEl = document.createElement('div');
            countEl.className = 'dex-count';
            countEl.textContent = `收藏：${entry.count || 0} / ${Game.getCollectGoal()}`;
        }

        // 简介：未发现时锁定文案，保留发现惊喜
        const descEl = document.createElement('div');
        descEl.className = 'dex-desc';
        descEl.textContent = entry.discovered ? entry.desc : '收集后解锁介绍';

        card.appendChild(imgSlot);
        card.appendChild(nameEl);
        card.appendChild(badges);
        if (countEl) card.appendChild(countEl);
        card.appendChild(descEl);
        return card;
    };

    const render = () => {
        const wrap = document.getElementById('dex-sections');
        const progress = document.getElementById('dex-progress');
        const dex = Game.getDessertDex();
        const types = Game.getCollectibleTypes();
        const entries = Object.values(dex);

        wrap.innerHTML = '';
        let foundCount = 0;

        // 按 rarity 自动分组（不写死甜品种类与数量，全部来自 DESSERT_DEX）
        const groups = new Map();
        entries.forEach((entry) => {
            if (!groups.has(entry.rarity)) groups.set(entry.rarity, []);
            groups.get(entry.rarity).push(entry);
        });
        // 分区排序：固定顺序在前，未知稀有度自动排在后面；空分组不生成区域
        const orderedRarities = [
            ...RARITY_ORDER.filter(r => groups.has(r)),
            ...[...groups.keys()].filter(r => !RARITY_ORDER.includes(r))
        ];

        orderedRarities.forEach((rarity) => {
            const groupEntries = groups.get(rarity);
            if (!groupEntries || groupEntries.length === 0) return;

            const label = RARITY_LABELS[rarity];
            const foundInGroup = groupEntries.filter(e => e.discovered).length;
            foundCount += foundInGroup;

            const section = document.createElement('div');
            section.className = 'dex-section';

            const title = document.createElement('div');
            title.className = 'dex-section-title ' + (label ? label.cls : 'rarity-locked');
            const titleText = document.createElement('span');
            titleText.textContent = label ? label.section : rarity + '甜品';
            const titleCount = document.createElement('span');
            titleCount.className = 'dex-section-count';
            titleCount.textContent = `${foundInGroup}/${groupEntries.length}`;
            title.appendChild(titleText);
            title.appendChild(titleCount);
            section.appendChild(title);

            const grid = document.createElement('div');
            grid.className = 'dex-grid';
            groupEntries.forEach((entry) => {
                grid.appendChild(buildCard(entry, types.find(t => t.name === entry.id)));
            });
            section.appendChild(grid);

            wrap.appendChild(section);
        });

        progress.textContent = `已发现 ${foundCount} / ${entries.length}`;
    };

    return { render };
})();

// 设置界面：音乐/音效开关 + BGM 音量（默认 40%）/ 音效音量（默认 90%）滑条。
// 设置写入 localStorage 持久化，下次打开自动恢复；音量变动即时生效。
const SettingsUI = (() => {
    const SETTINGS_KEY = 'nacrez_settings';
    let settings = { music: true, sound: true, bgmVolume: 0.4, sfxVolume: 0.9 };

    const load = () => {
        try {
            const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
            if (saved && typeof saved === 'object') Object.assign(settings, saved);
        } catch (e) { /* localStorage 不可用时用默认值 */ }
        // 数值兜底：非法/缺失时回落默认值并夹紧到 [0,1]
        if (typeof settings.bgmVolume !== 'number' || isNaN(settings.bgmVolume)) settings.bgmVolume = 0.4;
        if (typeof settings.sfxVolume !== 'number' || isNaN(settings.sfxVolume)) settings.sfxVolume = 0.9;
        settings.bgmVolume = Math.min(1, Math.max(0, settings.bgmVolume));
        settings.sfxVolume = Math.min(1, Math.max(0, settings.sfxVolume));
    };
    const save = () => {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
        catch (e) { /* 忽略 */ }
    };

    const applyLabel = (btn, on) => {
        if (!btn) return;
        btn.textContent = on ? '开启' : '关闭';
        btn.classList.toggle('setting-off', !on);
    };
    // 滑条同步：位置 + 百分比文字
    const applySlider = (id, labelId, vol) => {
        const slider = document.getElementById(id);
        if (slider) slider.value = Math.round(vol * 100);
        const label = document.getElementById(labelId);
        if (label) label.textContent = Math.round(vol * 100) + '%';
    };
    const render = () => {
        applyLabel(document.getElementById('music-toggle'), settings.music);
        applyLabel(document.getElementById('sound-toggle'), settings.sound);
        applySlider('bgm-volume', 'bgm-volume-label', settings.bgmVolume);
        applySlider('sfx-volume', 'sfx-volume-label', settings.sfxVolume);
    };

    const init = () => {
        load();
        render();
        const musicBtn = document.getElementById('music-toggle');
        if (musicBtn) musicBtn.addEventListener('click', () => {
            settings.music = !settings.music;
            save();
            render();
            AudioManager.applyVolume(); // 关→原地淡出到 0；开→恢复淡入（进度保留不重载）
        });
        const soundBtn = document.getElementById('sound-toggle');
        if (soundBtn) soundBtn.addEventListener('click', () => {
            settings.sound = !settings.sound;
            save();
            render();
        });
        // BGM 音量滑条：拖动即时生效（原地渐变，不重启音乐）
        const bgmSlider = document.getElementById('bgm-volume');
        if (bgmSlider) bgmSlider.addEventListener('input', () => {
            settings.bgmVolume = Math.min(1, Math.max(0, bgmSlider.value / 100));
            save();
            render();
            AudioManager.applyVolume();
        });
        // 音效音量滑条：下次触发音效时按新音量播放
        const sfxSlider = document.getElementById('sfx-volume');
        if (sfxSlider) sfxSlider.addEventListener('input', () => {
            settings.sfxVolume = Math.min(1, Math.max(0, sfxSlider.value / 100));
            save();
            render();
        });
        console.log("Settings initialized:", settings);
    };

    return {
        init,
        getSettings: () => ({
            music: settings.music,
            sound: settings.sound,
            bgmVolume: settings.bgmVolume,
            sfxVolume: settings.sfxVolume
        })
    };
})();

// 清除本地存档（设置页）：二次确认后清空全部 localStorage（图鉴收藏/玩偶次数/
// 最高分/成就/设置/教程标记一并清除），刷新页面即恢复初始游戏状态。
const ClearSaveUI = (() => {
    const init = () => {
        const btn = document.getElementById('clear-save-button');
        if (!btn) return;
        btn.addEventListener('click', () => {
            // 二次确认：防止误触一次性抹掉全部本地进度
            const ok = window.confirm('确定要清除本地存档吗？\n\n图鉴收藏、最高分、设置等所有本地数据\n将全部恢复为初始状态，此操作无法撤销。');
            if (!ok) return;
            try { localStorage.clear(); } catch (e) { /* 存储不可用：仍刷新复位内存态 */ }
            window.location.reload(); // 重载后从初始状态开始（最彻底的"恢复初始"）
        });
    };
    return { init };
})();

// BGM 音乐系统（HTML5 Audio）：双曲目 garden（开始界面/第一关）+ aurora（第二关）。
// - 每曲一个常驻 Audio 实例（loop + preload）：暂停/图鉴/衣柜切页零重载，循环无缝无爆音
// - play(同曲在播) → 直接跳过：主菜单→第一关保持播放进度无缝衔接
// - play(跨曲) → Crossfade：新曲从开头渐强，旧曲同步渐隐
// - 音量目标实时读 SettingsUI（音乐开关 × BGM 音量），滑条拖动即时生效
// - 浏览器 autoplay 拦截时挂起待播，首次用户手势自动恢复淡入
const AudioManager = (() => {
    const TRACKS = {
        garden: 'assets/bgm_garden.mp3',  // 开始界面 / 第一关
        aurora: 'assets/bgm_aurora.mp3'   // 第二关
    };
    const FADE_STEP_MS = 50;   // 渐变步长：50ms 线性插值，听感平滑
    const pool = {};           // 常驻 Audio 实例池（切歌/回放永不重新加载）
    const fadeTimers = {};     // 每曲独立渐变定时器（新渐变先清旧渐变防打架）
    let currentId = null;      // 当前逻辑曲目（同时只允许一首 BGM）
    let pendingId = null;      // autoplay 被拦截时挂起的待播曲目

    const getTrack = (id) => {
        if (!pool[id]) {
            const a = new Audio(TRACKS[id]);
            a.loop = true;          // 无限循环
            a.preload = 'auto';     // 预载：首次切歌零等待
            a.volume = 0;
            // 兜底个别浏览器 loop 失效：ended 后归零重播（loop 正常时不会触发）
            a.addEventListener('ended', () => { a.currentTime = 0; a.play().catch(() => {}); });
            pool[id] = a;
        }
        return pool[id];
    };

    // 目标音量 = 音乐开关 × BGM 音量设置
    const targetVolume = () => {
        const s = SettingsUI.getSettings();
        return s.music ? (typeof s.bgmVolume === 'number' ? s.bgmVolume : 0.4) : 0;
    };

    // 音量渐变：清旧定时器 → 50ms 步进线性逼近目标，到点执行回调（如 pause）
    const fadeVolume = (id, to, ms, done) => {
        const audio = pool[id];
        if (!audio) return;
        clearInterval(fadeTimers[id]);
        fadeTimers[id] = null;
        if (ms <= 0) {
            audio.volume = to;
            if (done) done();
            return;
        }
        const from = audio.volume;
        const start = performance.now();
        fadeTimers[id] = setInterval(() => {
            const t = Math.min(1, (performance.now() - start) / ms);
            audio.volume = from + (to - from) * t;
            if (t >= 1) {
                clearInterval(fadeTimers[id]);
                fadeTimers[id] = null;
                if (done) done();
            }
        }, FADE_STEP_MS);
    };

    // 播放指定曲目：
    // - 同曲已在播 → 直接返回（不重置进度：菜单→第一关无缝衔接）
    // - 跨曲 → 新曲从开头渐强 + 旧曲同步渐隐（Crossfade，同时只有一首出声）
    const play = (id, fadeMs) => {
        if (!TRACKS[id]) return;
        const audio = getTrack(id);
        const fade = fadeMs || 800;
        if (currentId === id && !audio.paused) return; // 无缝衔接：保持当前进度

        currentId = id;
        pendingId = null;
        audio.currentTime = 0; // 新曲从开头播放
        audio.volume = 0;
        const p = audio.play();
        const startFade = () => fadeVolume(id, targetVolume(), fade);
        if (p && p.then) {
            p.then(startFade).catch(() => {
                // autoplay 被拦截：保持静音挂起，等首次用户手势后淡入
                if (currentId === id) pendingId = id;
            });
        } else { startFade(); }

        // Crossfade：其余曲目渐隐后暂停（让出"同时只允许一首"）
        Object.keys(pool).forEach((other) => {
            if (other === id) return;
            const oa = pool[other];
            if (!oa.paused || oa.volume > 0) fadeVolume(other, 0, fade, () => oa.pause());
        });
    };

    // 游戏结束：所有在播 BGM 在 ms 内淡出（currentId 清空，下次 play 从头开始）
    const fadeOutAll = (ms) => {
        pendingId = null;
        Object.keys(pool).forEach((id) => {
            const a = pool[id];
            if (a.paused && a.volume <= 0) return;
            fadeVolume(id, 0, ms || 2000, () => { a.pause(); });
        });
        currentId = null;
    };

    // 设置变动（音乐开关 / BGM 音量滑条）：当前曲原地渐变到新目标，不重启不重载
    const applyVolume = () => {
        if (!currentId) return;
        const audio = pool[currentId];
        if (!audio) return;
        if (audio.paused) {
            // 音乐开关重新打开等场景：恢复播放并淡入
            const p = audio.play();
            if (p && p.then) p.then(() => fadeVolume(currentId, targetVolume(), 600)).catch(() => {});
        } else {
            fadeVolume(currentId, targetVolume(), 300);
        }
    };

    // 首次用户手势解锁：恢复被 autoplay 拦截的播放
    const unlock = () => {
        if (!pendingId) return;
        const id = pendingId;
        pendingId = null;
        const audio = pool[id];
        if (!audio || currentId !== id) return;
        const p = audio.play();
        if (p && p.then) p.then(() => fadeVolume(id, targetVolume(), 600)).catch(() => {});
    };

    // ==================== 音效（SFX）子系统 ====================
    // 音效文件在项目根目录（用户要求不重命名不移动）。HTML5 Audio 实例池实现
    // 多实例叠加（普通甜品连续收集不吞音），每音效设实例上限防连点炸内存。
    const SFX_FILES = {
        pop: 'bubble pop.mp3',        // 普通甜品 + 糖果泡泡碰撞
        sparkle: 'magic sparkle.wav', // 稀有甜品 + 传说星糖
        ice: '冰裂.wav',              // 漂浮冰晶碰撞
        tornado: 'Tornado Sound.mp3', // 糖果风暴云环境音（循环）
        click: 'click.wav'            // 所有按钮点击
    };
    const SFX_POOL_MAX = 8;      // 每音效同时存在的实例上限
    const TORNADO_RANGE = 150;   // 玩家距风暴云 150px 内播放环境音
    const TORNADO_GAIN = 0.25;   // 环境音基础音量 25%（再乘音效音量设置）
    const sfxPool = {};          // { id: [Audio,...] } 一次性音效实例池
    let tornadoAudio = null;     // 风暴云环境音常驻实例（全游戏只此一份，防叠音）
    let tornadoFadeTimer = null;
    let tornadoNear = false;
    let tornadoTargetVol = -1;

    // 当前音效总音量 = 音效开关 × 音效音量设置
    const sfxVolume = () => {
        const s = SettingsUI.getSettings();
        return s.sound ? (typeof s.sfxVolume === 'number' ? s.sfxVolume : 0.9) : 0;
    };

    // 取一个空闲实例；无空闲且未达上限则新建（浏览器按 src 缓存，预载后零等待）
    const acquireSfx = (id) => {
        const list = sfxPool[id] || (sfxPool[id] = []);
        let inst = null;
        for (let i = 0; i < list.length; i++) {
            if (list[i].paused) { inst = list[i]; break; }
        }
        if (!inst && list.length < SFX_POOL_MAX) {
            inst = new Audio(SFX_FILES[id]);
            inst.preload = 'auto';
            list.push(inst);
        }
        return inst || list[0]; // 极端连击全忙时复用首个实例，不无限扩池
    };

    // 播放一次性音效：gain 为相对系数，多实例并行互不打断
    const playSfx = (id, gain) => {
        if (!SFX_FILES[id]) return;
        const vol = sfxVolume() * (gain || 1);
        if (vol <= 0.0001) return; // 音效关/音量 0：静默
        const inst = acquireSfx(id);
        if (!inst) return;
        try {
            inst.currentTime = 0;
            inst.volume = Math.min(1, vol);
            const p = inst.play();
            if (p && p.catch) p.catch(() => { /* 自动播放策略拦截时静默 */ });
        } catch (e) { /* 播放异常不影响游戏 */ }
    };

    // 风暴云环境音常驻实例：loop 循环，全游戏只创建一次
    const ensureTornado = () => {
        if (!tornadoAudio) {
            tornadoAudio = new Audio(SFX_FILES.tornado);
            tornadoAudio.loop = true;
            tornadoAudio.preload = 'auto';
            tornadoAudio.volume = 0;
        }
        return tornadoAudio;
    };

    // 环境音渐变（独立于 BGM 渐变定时器）
    const fadeTornadoTo = (to, ms, done) => {
        const a = tornadoAudio;
        if (!a) return;
        clearInterval(tornadoFadeTimer);
        tornadoFadeTimer = null;
        const from = a.volume;
        const start = performance.now();
        tornadoFadeTimer = setInterval(() => {
            const t = Math.min(1, (performance.now() - start) / ms);
            a.volume = from + (to - from) * t;
            if (t >= 1) {
                clearInterval(tornadoFadeTimer);
                tornadoFadeTimer = null;
                if (done) done();
            }
        }, 50);
    };

    // 每帧调用：minDist = 玩家与最近糖果风暴云的中心距（null = 场上无风暴云）。
    // 150px 内 25% 音量循环播放，离开范围 0.3 秒淡出；多个风暴云只播这一份。
    const updateTornado = (minDist) => {
        tornadoNear = minDist !== null && minDist <= TORNADO_RANGE && sfxVolume() > 0.0001;
        const a = tornadoAudio || (tornadoNear ? ensureTornado() : null);
        if (!a) return;
        if (tornadoNear) {
            const target = Math.min(1, TORNADO_GAIN * sfxVolume());
            if (a.paused) {
                a.volume = 0;
                tornadoTargetVol = target;
                const p = a.play();
                if (p && p.catch) p.catch(() => {});
                fadeTornadoTo(target, 300);
            } else if (tornadoTargetVol !== target) {
                // 音效音量滑条/开关变化：原地平滑过渡到新目标
                tornadoTargetVol = target;
                fadeTornadoTo(target, 300);
            }
        } else if (!a.paused) {
            tornadoTargetVol = 0;
            fadeTornadoTo(0, 300, () => { if (!tornadoNear) a.pause(); });
        }
    };

    // 游戏结束/离开关卡：环境音 0.3 秒淡出并停止
    const stopTornado = () => {
        tornadoNear = false;
        tornadoTargetVol = -1;
        const a = tornadoAudio;
        if (!a || a.paused) return;
        fadeTornadoTo(0, 300, () => { if (!tornadoNear) a.pause(); });
    };

    const init = () => {
        // 预建实例并开始拉流：首次播放零等待
        Object.keys(TRACKS).forEach((id) => getTrack(id));
        // 音效预载：每音效先建 1 个实例 + 风暴云环境音常驻实例
        Object.keys(SFX_FILES).forEach((id) => {
            if (id === 'tornado') { ensureTornado(); return; }
            const inst = new Audio(SFX_FILES[id]);
            inst.preload = 'auto';
            (sfxPool[id] || (sfxPool[id] = [])).push(inst);
        });
        // 全局按钮点击音：事件委托捕获所有按钮（含动态创建的虚拟技能键/暂停/返回等）
        document.addEventListener('click', (e) => {
            const t = e.target;
            if (t && t.closest && t.closest('button')) playSfx('click');
        }, true);
        // 【临时测试入口】键盘 Enter / Space 也可触发 click 音：
        // 用于不用鼠标点击来测试声音（避免真实鼠标声干扰判断）。
        // 焦点在按钮上时不重复播放（浏览器会为聚焦按钮合成 click 事件，由上面的委托负责）
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const t = e.target;
            if (t && t.closest && t.closest('button')) return;
            playSfx('click');
        });
        document.addEventListener('pointerdown', unlock);
        document.addEventListener('keydown', unlock);
    };

    // 只读状态（验证用）：当前曲目 / 挂起待播 / 各曲音量·播放·进度 / 音效池状态
    const debugState = () => ({
        currentId,
        pendingId,
        tracks: Object.keys(pool).map((id) => ({
            id,
            volume: Math.round(pool[id].volume * 1000) / 1000,
            paused: pool[id].paused,
            time: Math.round(pool[id].currentTime * 10) / 10,
            file: (pool[id].src || '').split('/').pop()
        })),
        sfx: {
            pools: Object.keys(sfxPool).map((id) => ({
                id,
                total: sfxPool[id].length,
                busy: sfxPool[id].filter((a) => !a.paused).length,
                volume: Math.round((sfxPool[id][0] ? sfxPool[id][0].volume : 0) * 1000) / 1000
            })),
            tornado: tornadoAudio
                ? { paused: tornadoAudio.paused, volume: Math.round(tornadoAudio.volume * 1000) / 1000 }
                : null
        }
    });

    return {
        init, play, fadeOutAll, applyVolume,
        playSfx, updateTornado, stopTornado,
        getCurrentId: () => currentId, debugState
    };
})();

// 甜品玩偶伙伴信息界面：只读展示三只甜品玩偶与能力说明。
// 卡片由 EARTHEN_BEAST_TYPES 数据自动生成；图片走 ASSETS.beast 素材接口，
// 素材缺失时自动退回颜色圆点占位（与图鉴卡片同策略）。
const BeastInfoUI = (() => {
    const COLOR_NAMES = { blue: '蓝', purple: '紫', green: '绿' };
    const ABILITY_DESC = {
        score_bonus: '跟随你飞行：每收集一颗甜品额外 +10 分，并撒出金色星星',
        shield: '获得后会陪伴糯米团 5 秒，期间提供紫色玻璃泡泡护盾；陪伴结束后，护盾会继续存在 2 秒，可抵挡一次伤害，随后立即消失。',
        auto_collect: '跟随你飞行：自动吸附附近的甜品，收集更轻松'
    };

    const buildCard = (t) => {
        const card = document.createElement('div');
        card.className = 'beast-card';
        card.dataset.beast = t.name;

        const imgSlot = document.createElement('div');
        imgSlot.className = 'beast-img';
        const dot = document.createElement('div');
        dot.className = 'dex-color-dot';
        dot.style.background = t.color;
        imgSlot.appendChild(dot);
        const img = new Image();
        img.src = Game.getEarthenBeastImagePath(t.name);
        img.alt = t.title || ('甜品玩偶·' + (COLOR_NAMES[t.name] || t.name));
        img.onerror = () => img.remove(); // 素材未生成时保留色块圆点
        imgSlot.appendChild(img);

        const nameEl = document.createElement('div');
        nameEl.className = 'beast-name';
        nameEl.textContent = t.title || ('甜品玩偶·' + (COLOR_NAMES[t.name] || t.name));

        const descEl = document.createElement('div');
        descEl.className = 'beast-desc';
        descEl.textContent = ABILITY_DESC[t.effect] || '神秘的甜品玩偶伙伴';

        card.appendChild(imgSlot);
        card.appendChild(nameEl);
        card.appendChild(descEl);
        return card;
    };

    const render = () => {
        const wrap = document.getElementById('beast-cards');
        if (!wrap) return;
        wrap.innerHTML = '';
        Game.getEarthenBeastTypes().forEach((t) => wrap.appendChild(buildCard(t)));
    };

    return { render };
})();

// 汽水视觉特效：为所有按钮注入"薄荷汽水玻璃杯"装饰层（泡沫/液面波浪/上升气泡/玻璃高光）。
// 纯视觉层：pointer-events:none、不改按钮结构与事件，功能零影响；
// 手机虚拟技能键等动态创建的按钮由 MutationObserver 自动补上装饰。
const SodaFX = (() => {
    // 液面波浪：一条奶油色起伏曲线，两段拼接后平移实现"液体晃动"
    const WAVE_SVG = '<svg viewBox="0 0 240 12" preserveAspectRatio="none">' +
        '<path d="M0 7 Q 20 1 40 7 T 80 7 T 120 7 T 160 7 T 200 7 T 240 7 V 12 H 0 Z" fill="rgba(255,255,255,0.4)"/></svg>';

    const rand = (min, max) => min + Math.random() * (max - min);

    // 泡沫：顶部细密小白点，大小/位置/透明度随机，模拟刚倒出的汽水泡沫
    const buildFoam = () => {
        const dots = [];
        for (let i = 0; i < 12; i++) {
            const r = rand(1.5, 4).toFixed(1);
            const x = rand(3, 97).toFixed(1);
            const y = rand(15, 85).toFixed(0);
            const a = rand(0.5, 0.95).toFixed(2);
            dots.push(`radial-gradient(circle ${r}px at ${x}% ${y}%, rgba(255,255,255,${a}) 98%, transparent 100%)`);
        }
        return dots.join(',');
    };

    // 气泡：桌面约 9 个；触摸设备减到 5 个（低端机保帧率，观感依旧轻盈）
    const buildBubbles = (h) => {
        const n = IS_TOUCH ? 5 : 9;
        let html = '';
        for (let i = 0; i < n; i++) {
            const size = Math.round(rand(3, 8));
            const rise = Math.round(h * rand(0.42, 0.6));
            html += `<i class="soda-bubble" style="--x:${rand(6, 88).toFixed(1)}%;--s:${size}px;` +
                `--t:${rand(2.6, 5.2).toFixed(2)}s;--delay:-${rand(0, 5).toFixed(2)}s;` +
                `--rise:-${rise}px;--sway:${rand(-6, 6).toFixed(1)}px;--o:${rand(0.45, 0.8).toFixed(2)}"></i>`;
        }
        return html;
    };

    const decorate = (btn) => {
        if (!btn || btn.dataset.sodaFx || btn.tagName !== 'BUTTON') return;
        if (btn.closest && btn.closest('#virtual-dpad')) return; // 虚拟方向键：小尺寸玻璃按键不注入汽水装饰，保持箭头清晰
        btn.dataset.sodaFx = '1';
        const fx = document.createElement('span');
        fx.className = 'soda-fx';
        fx.setAttribute('aria-hidden', 'true');
        const h = Math.max(btn.offsetHeight || 40, 36);
        fx.innerHTML =
            `<span class="soda-foam" style="background-image:${buildFoam()}"></span>` +
            `<span class="soda-surface">${WAVE_SVG}</span>` +
            `<span class="soda-bubbles">${buildBubbles(h)}</span>` +
            `<span class="soda-shine"></span>` +
            `<span class="soda-ripple"></span>`;
        btn.appendChild(fx);
    };

    const decorateAll = (root) => {
        (root || document).querySelectorAll('button').forEach(decorate);
    };

    const init = () => {
        decorateAll();
        // 之后动态出现的按钮（每局重建的手机技能键等）自动补装饰；
        // textContent 赋值（如设置开关改字）会清掉装饰层，检测到被移除时自动补回
        const obs = new MutationObserver((muts) => {
            muts.forEach((m) => {
                m.removedNodes.forEach((n) => {
                    if (n.nodeType === 1 && n.classList && n.classList.contains('soda-fx') &&
                        m.target && m.target.tagName === 'BUTTON') {
                        delete m.target.dataset.sodaFx;
                        decorate(m.target);
                    }
                });
            });
            muts.forEach((m) => m.addedNodes.forEach((n) => {
                if (n.nodeType !== 1) return;
                if (n.tagName === 'BUTTON') decorate(n);
                if (n.querySelectorAll) n.querySelectorAll('button').forEach(decorate);
            }));
        });
        obs.observe(document.body, { childList: true, subtree: true });
        // 字体/布局稳定后重算一次气泡上升高度
        setTimeout(() => {
            document.querySelectorAll('.soda-fx').forEach((fx) => {
                const h = fx.parentElement.offsetHeight;
                if (!h) return;
                fx.querySelectorAll('.soda-bubble').forEach((b) => {
                    b.style.setProperty('--rise', -(h * rand(0.42, 0.6)) + 'px');
                });
            });
        }, 600);
    };

    return { init, decorate, decorateAll };
})();

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Content Loaded. Initializing GameManager and Game.");
    GameManager.init();
    Game.init();
    Game.initCharacterHero(); // 角色选择页视觉中心：糯米团 + 飞船合成
    SettingsUI.init();
    AudioManager.init(); // BGM：预建常驻 Audio 实例 + 用户手势解锁 autoplay
    ClearSaveUI.init(); // 设置页「清除本地存档」按钮（二次确认）
    SodaFX.init(); // 纯视觉：给所有按钮注入汽水泡沫/气泡/波纹装饰层
});