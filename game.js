// Karinca - Epic Snake Game
// Main game logic with comprehensive features

(function() {
    'use strict';

    // Game Constants
    const GAME_CONFIG = {
        CANVAS_WIDTH: 800,
        CANVAS_HEIGHT: 600,
        GRID_SIZE: 20,
        TARGET_FPS: 60,
        MAX_DELTA_TIME: 1000 / 30, // Cap delta time to 30fps minimum
        
        // Game mechanics
        BASE_SPEED: 120, // pixels per second
        SPRINT_SPEED_MULTIPLIER: 1.8,
        SPRINT_LENGTH_DRAIN: 2, // length units per second while sprinting
        SPAWN_PROTECTION_TIME: 2000, // ms
        
        // Hit pause settings
        HIT_PAUSE: {
            FOOD: 80,
            KILL: 150,
            POWER_UP: 100
        },
        
        // Screen shake
        SCREEN_SHAKE: {
            FOOD: 2,
            KILL: 8,
            POWER_UP: 4
        },
        
        // Camera
        SPRINT_ZOOM_SCALE: 0.92,
        ZOOM_EASING: 0.1,
        
        // Power-ups
        POWER_UP_SPAWN_INTERVAL: 6000, // ms (reduced for testing)
        MAX_POWER_UPS: 3, // Increased for better gameplay
        
        // Spatial hashing
        SPATIAL_CELL_SIZE: 100,
        
        // Performance
        MAX_PARTICLES: 200,
        MAX_FOOD_ITEMS: 150
    };

    // Game State
    let gameState = {
        current: 'start', // start, playing, paused, levelComplete, gameOver, gameComplete
        level: 1,
        lives: 3,
        score: 0,
        xp: 0,
        totalXP: 0,
        startTime: 0,
        levelTime: 0,
        isPaused: false,
        isGameComplete: false
    };

    // Game objects
    let canvas, ctx, miniMapCanvas, miniMapCtx;
    let player, bots = [], foods = [], particles = [], powerUps = [];
    let camera = { x: 0, y: 0, scale: 1, targetScale: 1, shake: { x: 0, y: 0, intensity: 0 } };
    let spatialHash;
    let objectPools = {};
    
    // Input handling
    let input = {
        mouse: { x: 0, y: 0 },
        keys: {},
        touch: { active: false, x: 0, y: 0, startX: 0, startY: 0 },
        sprint: false
    };
    
    // Audio context
    let audioContext;
    let audioSettings = { volume: 0.5 };
    
    // Game timing
    let lastTime = 0;
    let accumulator = 0;
    let hitPauseTimer = 0;
    let fixedTimeStep = 1000 / GAME_CONFIG.TARGET_FPS;
    
    // Game feel effects
    let screenShake = { x: 0, y: 0, intensity: 0, duration: 0 };
    let timeScale = 1.0;
    
    // Systems
    let achievementSystem, metaProgression, powerUpSystem, aiSystem;

    // ============================================================================
    // UTILITY CLASSES
    // ============================================================================

    class Vector2 {
        constructor(x = 0, y = 0) {
            this.x = x;
            this.y = y;
        }
        
        static distance(a, b) {
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            return Math.sqrt(dx * dx + dy * dy);
        }
        
        static normalize(v) {
            const length = Math.sqrt(v.x * v.x + v.y * v.y);
            if (length === 0) return { x: 0, y: 0 };
            return { x: v.x / length, y: v.y / length };
        }
        
        static dot(a, b) {
            return a.x * b.x + a.y * b.y;
        }
        
        static lerp(a, b, t) {
            return {
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t
            };
        }
    }

    class SpatialHash {
        constructor(cellSize) {
            this.cellSize = cellSize;
            this.grid = new Map();
        }
        
        clear() {
            this.grid.clear();
        }
        
        getKey(x, y) {
            const cellX = Math.floor(x / this.cellSize);
            const cellY = Math.floor(y / this.cellSize);
            return `${cellX},${cellY}`;
        }
        
        insert(object, x, y) {
            const key = this.getKey(x, y);
            if (!this.grid.has(key)) {
                this.grid.set(key, []);
            }
            this.grid.get(key).push(object);
        }
        
        query(x, y, radius) {
            const results = [];
            const cellRadius = Math.ceil(radius / this.cellSize);
            const centerCellX = Math.floor(x / this.cellSize);
            const centerCellY = Math.floor(y / this.cellSize);
            
            for (let dx = -cellRadius; dx <= cellRadius; dx++) {
                for (let dy = -cellRadius; dy <= cellRadius; dy++) {
                    const key = `${centerCellX + dx},${centerCellY + dy}`;
                    const cell = this.grid.get(key);
                    if (cell) {
                        results.push(...cell);
                    }
                }
            }
            
            return results;
        }
    }

    class ObjectPool {
        constructor(createFn, resetFn, initialSize = 50) {
            this.createFn = createFn;
            this.resetFn = resetFn;
            this.pool = [];
            this.active = [];
            
            for (let i = 0; i < initialSize; i++) {
                this.pool.push(this.createFn());
            }
        }
        
        get() {
            let obj = this.pool.pop();
            if (!obj) {
                obj = this.createFn();
            }
            this.active.push(obj);
            return obj;
        }
        
        release(obj) {
            const index = this.active.indexOf(obj);
            if (index !== -1) {
                this.active.splice(index, 1);
                this.resetFn(obj);
                this.pool.push(obj);
            }
        }
        
        releaseAll() {
            while (this.active.length > 0) {
                this.release(this.active[0]);
            }
        }
    }

    // ============================================================================
    // ACHIEVEMENT SYSTEM
    // ============================================================================

    class AchievementSystem {
        constructor() {
            this.achievements = {
                firstKill: {
                    id: 'firstKill',
                    name: 'First Blood',
                    description: 'Defeat your first enemy',
                    icon: '⚔️',
                    unlocked: false,
                    progress: 0,
                    target: 1
                },
                flawlessLevel: {
                    id: 'flawlessLevel',
                    name: 'Untouchable',
                    description: 'Complete a level without taking damage',
                    icon: '🛡️',
                    unlocked: false,
                    progress: 0,
                    target: 1
                },
                fiveKills: {
                    id: 'fiveKills',
                    name: 'Rampage',
                    description: 'Defeat 5 enemies in a single level',
                    icon: '💀',
                    unlocked: false,
                    progress: 0,
                    target: 5
                },
                reachLevel10: {
                    id: 'reachLevel10',
                    name: 'Getting Started',
                    description: 'Reach level 10',
                    icon: '🎯',
                    unlocked: false,
                    progress: 0,
                    target: 10
                },
                reachLevel50: {
                    id: 'reachLevel50',
                    name: 'Halfway There',
                    description: 'Reach level 50',
                    icon: '🌟',
                    unlocked: false,
                    progress: 0,
                    target: 50
                },
                reachLevel99: {
                    id: 'reachLevel99',
                    name: 'Elite Player',
                    description: 'Reach level 99',
                    icon: '👑',
                    unlocked: false,
                    progress: 0,
                    target: 99
                },
                collectPowerUps: {
                    id: 'collectPowerUps',
                    name: 'Power Collector',
                    description: 'Collect 100 power-ups total',
                    icon: '⚡',
                    unlocked: false,
                    progress: 0,
                    target: 100
                },
                longSnake: {
                    id: 'longSnake',
                    name: 'Mega Snake',
                    description: 'Reach a length of 100',
                    icon: '🐍',
                    unlocked: false,
                    progress: 0,
                    target: 100
                }
            };
            
            this.sessionStats = {
                kills: 0,
                powerUpsCollected: 0,
                maxLengthThisLevel: 5,
                damageThisLevel: false
            };
            
            this.loadProgress();
        }
        
        saveProgress() {
            const data = {
                achievements: this.achievements,
                totalStats: {
                    totalKills: this.getTotalStat('kills'),
                    totalPowerUps: this.getTotalStat('powerUps'),
                    maxLevel: this.getTotalStat('maxLevel'),
                    maxLength: this.getTotalStat('maxLength')
                }
            };
            localStorage.setItem('karinca_achievements', JSON.stringify(data));
        }
        
        loadProgress() {
            try {
                const data = JSON.parse(localStorage.getItem('karinca_achievements'));
                if (data && data.achievements) {
                    // Merge saved achievements with defaults
                    Object.keys(this.achievements).forEach(key => {
                        if (data.achievements[key]) {
                            this.achievements[key] = { ...this.achievements[key], ...data.achievements[key] };
                        }
                    });
                }
            } catch (e) {
                console.warn('Failed to load achievement progress:', e);
            }
        }
        
        getTotalStat(stat) {
            try {
                const data = JSON.parse(localStorage.getItem('karinca_achievements'));
                return data?.totalStats?.[stat] || 0;
            } catch (e) {
                return 0;
            }
        }
        
        unlock(achievementId) {
            const achievement = this.achievements[achievementId];
            if (achievement && !achievement.unlocked) {
                achievement.unlocked = true;
                achievement.progress = achievement.target;
                this.showToast(achievement);
                this.saveProgress();
                
                // Add XP bonus for achievement
                gameState.xp += 50;
                gameState.totalXP += 50;
                
                console.log(`Achievement unlocked: ${achievement.name}`);
            }
        }
        
        updateProgress(achievementId, amount = 1) {
            const achievement = this.achievements[achievementId];
            if (achievement && !achievement.unlocked) {
                achievement.progress = Math.min(achievement.progress + amount, achievement.target);
                if (achievement.progress >= achievement.target) {
                    this.unlock(achievementId);
                }
                this.saveProgress();
            }
        }
        
        showToast(achievement) {
            const toast = document.getElementById('achievementToast');
            const title = document.getElementById('toastAchievement');
            
            title.textContent = achievement.name;
            toast.classList.remove('hidden');
            toast.classList.add('show');
            
            // Hide after 4 seconds
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => {
                    toast.classList.add('hidden');
                }, 500);
            }, 4000);
        }
        
        checkKill() {
            this.sessionStats.kills++;
            this.updateProgress('firstKill');
            this.updateProgress('fiveKills');
        }
        
        checkPowerUpCollected() {
            this.sessionStats.powerUpsCollected++;
            this.updateProgress('collectPowerUps');
        }
        
        checkLength(length) {
            this.sessionStats.maxLengthThisLevel = Math.max(this.sessionStats.maxLengthThisLevel, length);
            this.updateProgress('longSnake', 0); // Just check current progress
            if (length >= 100) {
                this.updateProgress('longSnake', length - this.achievements.longSnake.progress);
            }
        }
        
        checkLevelComplete(level) {
            this.updateProgress('reachLevel10', level >= 10 ? 1 : 0);
            this.updateProgress('reachLevel50', level >= 50 ? 1 : 0);
            this.updateProgress('reachLevel99', level >= 99 ? 1 : 0);
            
            if (!this.sessionStats.damageThisLevel) {
                this.updateProgress('flawlessLevel');
            }
            
            // Reset session stats for next level
            this.sessionStats.kills = 0;
            this.sessionStats.damageThisLevel = false;
            this.sessionStats.maxLengthThisLevel = 5;
        }
        
        checkDamage() {
            this.sessionStats.damageThisLevel = true;
        }
        
        getUnlockedCount() {
            return Object.values(this.achievements).filter(a => a.unlocked).length;
        }
    }

    // ============================================================================
    // META PROGRESSION SYSTEM
    // ============================================================================

    class MetaProgression {
        constructor() {
            this.upgrades = {
                startLength: {
                    id: 'startLength',
                    name: 'Starting Length',
                    description: 'Increase starting snake length',
                    baseValue: 5,
                    increment: 1,
                    baseCost: 100,
                    costMultiplier: 1.5,
                    maxLevel: 10,
                    currentLevel: 0,
                    icon: '📏'
                },
                baseSpeed: {
                    id: 'baseSpeed',
                    name: 'Base Speed',
                    description: 'Increase movement speed',
                    baseValue: 1,
                    increment: 0.05,
                    baseCost: 150,
                    costMultiplier: 1.6,
                    maxLevel: 15,
                    currentLevel: 0,
                    icon: '💨'
                },
                sprintEfficiency: {
                    id: 'sprintEfficiency',
                    name: 'Sprint Efficiency',
                    description: 'Reduce length drain while sprinting',
                    baseValue: 1,
                    increment: 0.1,
                    baseCost: 200,
                    costMultiplier: 1.7,
                    maxLevel: 8,
                    currentLevel: 0,
                    icon: '🏃'
                },
                foodValue: {
                    id: 'foodValue',
                    name: 'Food Value',
                    description: 'Increase growth from food',
                    baseValue: 1,
                    increment: 0.05,
                    baseCost: 120,
                    costMultiplier: 1.4,
                    maxLevel: 12,
                    currentLevel: 0,
                    icon: '🍎'
                }
            };
            
            this.xp = 0;
            this.loadProgress();
        }
        
        saveProgress() {
            const data = {
                upgrades: this.upgrades,
                xp: this.xp
            };
            localStorage.setItem('karinca_progression', JSON.stringify(data));
        }
        
        loadProgress() {
            try {
                const data = JSON.parse(localStorage.getItem('karinca_progression'));
                if (data) {
                    if (data.upgrades) {
                        Object.keys(this.upgrades).forEach(key => {
                            if (data.upgrades[key]) {
                                this.upgrades[key].currentLevel = data.upgrades[key].currentLevel || 0;
                            }
                        });
                    }
                    this.xp = data.xp || 0;
                }
            } catch (e) {
                console.warn('Failed to load progression data:', e);
            }
        }
        
        getCost(upgradeId) {
            const upgrade = this.upgrades[upgradeId];
            return Math.floor(upgrade.baseCost * Math.pow(upgrade.costMultiplier, upgrade.currentLevel));
        }
        
        canAfford(upgradeId) {
            return this.xp >= this.getCost(upgradeId);
        }
        
        isMaxLevel(upgradeId) {
            const upgrade = this.upgrades[upgradeId];
            return upgrade.currentLevel >= upgrade.maxLevel;
        }
        
        buyUpgrade(upgradeId) {
            const upgrade = this.upgrades[upgradeId];
            const cost = this.getCost(upgradeId);
            
            if (this.canAfford(upgradeId) && !this.isMaxLevel(upgradeId)) {
                this.xp -= cost;
                upgrade.currentLevel++;
                this.saveProgress();
                return true;
            }
            return false;
        }
        
        getCurrentValue(upgradeId) {
            const upgrade = this.upgrades[upgradeId];
            return upgrade.baseValue + (upgrade.increment * upgrade.currentLevel);
        }
        
        // Getter methods for game systems
        getStartLength() {
            return Math.floor(this.getCurrentValue('startLength'));
        }
        
        getSpeedMultiplier() {
            return this.getCurrentValue('baseSpeed');
        }
        
        getSprintEfficiency() {
            return Math.max(0.1, 1 - (this.upgrades.sprintEfficiency.currentLevel * 0.1));
        }
        
        getFoodValueMultiplier() {
            return this.getCurrentValue('foodValue');
        }
        
        addXP(amount) {
            this.xp += amount;
            gameState.totalXP += amount;
            this.saveProgress();
        }
    }

    class Snake {
        constructor(x, y, isPlayer = false) {
            this.segments = [{ x, y }];
            this.direction = { x: 1, y: 0 };
            this.targetDirection = { x: 1, y: 0 };
            this.speed = GAME_CONFIG.BASE_SPEED;
            this.length = 5;
            this.isPlayer = isPlayer;
            this.isDead = false;
            this.color = isPlayer ? '#4fc3f7' : '#ff5722';
            this.name = isPlayer ? 'Player' : `Bot${Math.floor(Math.random() * 1000)}`;
            
            // Player specific
            this.spawnProtection = isPlayer ? GAME_CONFIG.SPAWN_PROTECTION_TIME : 0;
            this.isSprinting = false;
            this.powerUps = new Map();
            
            // AI specific
            this.aiState = 'wander';
            this.aiTarget = null;
            this.aiMemory = {
                dangerAreas: [],
                foodClusters: [],
                lastPlayerPos: null
            };
            
            // Initialize segments
            for (let i = 1; i < this.length; i++) {
                this.segments.push({
                    x: x - i * GAME_CONFIG.GRID_SIZE,
                    y: y
                });
            }
        }
        
        update(deltaTime) {
            if (this.isDead) return;
            
            // Update spawn protection
            if (this.spawnProtection > 0) {
                this.spawnProtection -= deltaTime;
            }
            
            // Update power-ups
            this.updatePowerUps(deltaTime);
            
            // AI behavior for bots
            if (!this.isPlayer) {
                this.updateAI(deltaTime);
            }
            
            // Apply direction changes
            this.direction = { ...this.targetDirection };
            
            // Calculate effective speed
            let effectiveSpeed = this.speed;
            if (this.isPlayer) {
                effectiveSpeed *= metaProgression.getSpeedMultiplier();
                if (this.isSprinting) {
                    effectiveSpeed *= GAME_CONFIG.SPRINT_SPEED_MULTIPLIER;
                    
                    // Check if player has speed burst power-up
                    if (!this.powerUps.has('speed')) {
                        // Drain length while sprinting (only if no speed burst)
                        const drainRate = GAME_CONFIG.SPRINT_LENGTH_DRAIN * metaProgression.getSprintEfficiency();
                        this.length = Math.max(3, this.length - drainRate * (deltaTime / 1000));
                    }
                }
            }
            
            // Check for power-up effects
            if (this.powerUps.has('speed')) {
                effectiveSpeed *= 1.5;
            }
            
            // Move snake
            const moveDistance = effectiveSpeed * (deltaTime / 1000);
            const head = this.segments[0];
            const newHead = {
                x: head.x + this.direction.x * moveDistance,
                y: head.y + this.direction.y * moveDistance
            };
            
            this.segments.unshift(newHead);
            
            // Remove tail segments if needed
            while (this.segments.length > this.length) {
                this.segments.pop();
            }
            
            // Boundary collision
            if (newHead.x < 0 || newHead.x > canvas.width || 
                newHead.y < 0 || newHead.y > canvas.height) {
                this.kill();
            }
        }
        
        updatePowerUps(deltaTime) {
            for (const [type, powerUp] of this.powerUps) {
                powerUp.timeLeft -= deltaTime;
                if (powerUp.timeLeft <= 0) {
                    this.removePowerUp(type);
                }
            }
        }
        
        updateAI(deltaTime) {
            // Simple AI for now - avoid player and move randomly
            if (Math.random() < 0.015) { // Reduced frequency of direction changes
                const directions = [
                    { x: 1, y: 0 }, { x: -1, y: 0 },
                    { x: 0, y: 1 }, { x: 0, y: -1 }
                ];
                
                // If player is nearby, try to move away
                if (player && !player.isDead) {
                    const head = this.segments[0];
                    const playerHead = player.segments[0];
                    const distance = Vector2.distance(head, playerHead);
                    
                    if (distance < 100) {
                        // Move away from player
                        const awayDir = Vector2.normalize({
                            x: head.x - playerHead.x,
                            y: head.y - playerHead.y
                        });
                        this.targetDirection = awayDir;
                        return;
                    }
                }
                
                this.targetDirection = directions[Math.floor(Math.random() * directions.length)];
            }
        }
        
        addPowerUp(type, duration) {
            this.powerUps.set(type, { timeLeft: duration });
            powerUpSystem.onPowerUpActivated(this, type);
        }
        
        removePowerUp(type) {
            this.powerUps.delete(type);
            powerUpSystem.onPowerUpExpired(this, type);
        }
        
        grow(amount = 1) {
            const baseGrowth = amount * metaProgression.getFoodValueMultiplier();
            this.length += baseGrowth;
            
            // Achievement: check length milestone
            if (this.isPlayer) {
                achievementSystem.checkLength(this.length);
            }
        }
        
        kill() {
            if (this.isDead) return;
            
            this.isDead = true;
            
            // Create food from segments
            this.segments.forEach(segment => {
                createFood(segment.x, segment.y, 'death');
            });
            
            // Enhanced death effects
            if (this.isPlayer) {
                addScreenShake(GAME_CONFIG.SCREEN_SHAKE.KILL, 400);
                addHitPause(GAME_CONFIG.HIT_PAUSE.KILL);
                playSound('death');
                
                // Achievement: player took damage
                achievementSystem.checkDamage();
                
                // Create dramatic death particles
                createParticles(this.segments[0].x, this.segments[0].y, '#ff4444', 20);
            } else {
                addScreenShake(GAME_CONFIG.SCREEN_SHAKE.KILL * 0.5, 250);
                playSound('kill');
                
                // Achievement: enemy kill
                achievementSystem.checkKill();
                
                // Create enemy death particles
                createParticles(this.segments[0].x, this.segments[0].y, '#ffaa00', 15);
            }
        }
        
        checkCollision(other) {
            if (this.isDead || other.isDead) return false;
            if (this.spawnProtection > 0) return false;
            if (this.powerUps.has('shield')) return false;
            if (this.powerUps.has('invisibility') && other.isPlayer) return false;
            
            const head = this.segments[0];
            
            // Check collision with other snake's segments
            for (let i = (this === other ? 4 : 0); i < other.segments.length; i++) { // Skip first 4 segments for self-collision
                const segment = other.segments[i];
                if (Vector2.distance(head, segment) < GAME_CONFIG.GRID_SIZE * 0.6) { // Reduced collision radius
                    return true;
                }
            }
            
            return false;
        }
        
        draw(ctx, interpolation = 1) {
            if (this.isDead) return;
            
            ctx.save();
            
            // Apply spawn protection effect
            if (this.spawnProtection > 0) {
                const alpha = 0.3 + 0.4 * Math.sin(Date.now() * 0.02); // More visible pulsing
                ctx.globalAlpha = alpha;
                
                // Draw protection shield
                ctx.strokeStyle = '#00ff00';
                ctx.lineWidth = 3;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.arc(this.segments[0].x, this.segments[0].y, GAME_CONFIG.GRID_SIZE * 1.2, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            
            // Apply invisibility effect
            if (this.powerUps.has('invisibility')) {
                ctx.globalAlpha = 0.3;
            }
            
            ctx.fillStyle = this.color;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            
            // Draw segments
            this.segments.forEach((segment, index) => {
                const size = index === 0 ? GAME_CONFIG.GRID_SIZE : GAME_CONFIG.GRID_SIZE * 0.8;
                ctx.fillRect(
                    segment.x - size / 2,
                    segment.y - size / 2,
                    size,
                    size
                );
                
                if (index === 0) {
                    ctx.strokeRect(
                        segment.x - size / 2,
                        segment.y - size / 2,
                        size,
                        size
                    );
                }
            });
            
            // Draw power-up effects
            if (this.powerUps.has('shield')) {
                ctx.strokeStyle = '#4fc3f7';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(this.segments[0].x, this.segments[0].y, GAME_CONFIG.GRID_SIZE, 0, Math.PI * 2);
                ctx.stroke();
            }
            
            ctx.restore();
        }
    }

    class Food {
        constructor(x, y, type = 'normal', value = 1) {
            this.x = x;
            this.y = y;
            this.type = type;
            this.value = value;
            this.size = GAME_CONFIG.GRID_SIZE * 0.6;
            this.color = this.getColorByType();
            this.pulsePhase = Math.random() * Math.PI * 2;
            this.age = 0;
            this.maxAge = type === 'death' ? 30000 : Infinity;
        }
        
        getColorByType() {
            switch (this.type) {
                case 'death': return '#ffeb3b';
                case 'bonus': return '#e91e63';
                default: return '#4caf50';
            }
        }
        
        update(deltaTime) {
            this.age += deltaTime;
            this.pulsePhase += deltaTime * 0.005;
            
            // Death food fades over time
            if (this.type === 'death' && this.age > this.maxAge) {
                return false; // Mark for removal
            }
            
            return true;
        }
        
        draw(ctx) {
            ctx.save();
            
            const pulse = 1 + 0.2 * Math.sin(this.pulsePhase);
            const size = this.size * pulse;
            
            // Fade effect for death food
            if (this.type === 'death') {
                const fadeAlpha = Math.max(0, 1 - (this.age / this.maxAge));
                ctx.globalAlpha = fadeAlpha;
            }
            
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, size / 2, 0, Math.PI * 2);
            ctx.fill();
            
            // Glow effect
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(this.x, this.y, size / 4, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.restore();
        }
        
        checkCollision(snake) {
            const head = snake.segments[0];
            return Vector2.distance(this, head) < this.size;
        }
    }

    // ============================================================================
    // GAME SYSTEMS
    // ============================================================================

    class PowerUpSystem {
        constructor() {
            this.types = {
                shield: { 
                    duration: 10000, 
                    color: '#4fc3f7', 
                    icon: '🛡️',
                    weight: 25 
                },
                magnet: { 
                    duration: 15000, 
                    color: '#ffeb3b', 
                    icon: '🧲',
                    weight: 30 
                },
                speed: { 
                    duration: 5000, 
                    color: '#4caf50', 
                    icon: '⚡',
                    weight: 25 
                },
                invisibility: { 
                    duration: 8000, 
                    color: '#9e9e9e', 
                    icon: '👻',
                    weight: 20 
                }
            };
            
            this.spawnTimer = 0;
        }
        
        update(deltaTime) {
            this.spawnTimer += deltaTime;
            
            if (this.spawnTimer >= GAME_CONFIG.POWER_UP_SPAWN_INTERVAL && 
                powerUps.length < GAME_CONFIG.MAX_POWER_UPS) {
                this.spawnPowerUp();
                this.spawnTimer = 0;
            }
            
            // Apply magnet effect for players with magnet power-up
            if (player && !player.isDead && player.powerUps.has('magnet')) {
                this.magnetEffect(player);
            }
        }
        
        spawnPowerUp() {
            const type = this.getRandomType();
            const x = Math.random() * (canvas.width - 100) + 50;
            const y = Math.random() * (canvas.height - 100) + 50;
            
            powerUps.push(new PowerUp(x, y, type));
        }
        
        getRandomType() {
            const totalWeight = Object.values(this.types).reduce((sum, type) => sum + type.weight, 0);
            let random = Math.random() * totalWeight;
            
            for (const [name, type] of Object.entries(this.types)) {
                random -= type.weight;
                if (random <= 0) return name;
            }
            
            return 'shield';
        }
        
        onPowerUpActivated(snake, type) {
            // Type-specific activation logic
            switch (type) {
                case 'magnet':
                    // Magnet effect will be handled in the update loop
                    this.magnetEffect(snake);
                    break;
                case 'shield':
                    // Visual shield effect
                    break;
                case 'speed':
                    // Speed boost handled in snake update
                    break;
                case 'invisibility':
                    // Invisibility effects are handled in collision detection
                    break;
            }
        }
        
        magnetEffect(snake) {
            // Pull nearby food towards the player
            const magnetRadius = 120;
            const magnetForce = 300; // pixels per second
            
            foods.forEach(food => {
                const distance = Vector2.distance(food, snake.segments[0]);
                if (distance < magnetRadius && distance > 20) {
                    const direction = Vector2.normalize({
                        x: snake.segments[0].x - food.x,
                        y: snake.segments[0].y - food.y
                    });
                    
                    const force = magnetForce / Math.max(distance, 30);
                    food.x += direction.x * force * (1/60); // Assume 60fps
                    food.y += direction.y * force * (1/60);
                }
            });
        }
        
        onPowerUpExpired(snake, type) {
            // Cleanup when power-up expires
        }
    }

    class PowerUp {
        constructor(x, y, type) {
            this.x = x;
            this.y = y;
            this.type = type;
            this.config = powerUpSystem.types[type];
            this.size = GAME_CONFIG.GRID_SIZE;
            this.glowPhase = Math.random() * Math.PI * 2;
            this.bobPhase = Math.random() * Math.PI * 2;
        }
        
        update(deltaTime) {
            this.glowPhase += deltaTime * 0.008;
            this.bobPhase += deltaTime * 0.003;
        }
        
        draw(ctx) {
            ctx.save();
            
            const glow = 1 + 0.4 * Math.sin(this.glowPhase);
            const bob = Math.sin(this.bobPhase) * 8;
            
            // Enhanced glow effect
            ctx.shadowColor = this.config.color;
            ctx.shadowBlur = 25 * glow;
            
            // Outer glow ring
            ctx.strokeStyle = this.config.color;
            ctx.lineWidth = 3;
            ctx.globalAlpha = 0.3 * glow;
            ctx.beginPath();
            ctx.arc(this.x, this.y + bob, this.size * 0.8, 0, Math.PI * 2);
            ctx.stroke();
            
            // Main shape with gradient
            ctx.globalAlpha = 1;
            const gradient = ctx.createRadialGradient(this.x, this.y + bob, 0, this.x, this.y + bob, this.size / 2);
            gradient.addColorStop(0, this.config.color);
            gradient.addColorStop(1, this.config.color + '80'); // Semi-transparent
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(this.x, this.y + bob, this.size / 2, 0, Math.PI * 2);
            ctx.fill();
            
            // Icon with shadow
            ctx.shadowColor = '#000';
            ctx.shadowBlur = 5;
            ctx.font = `${this.size * 0.6}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#fff';
            ctx.fillText(this.config.icon, this.x, this.y + bob);
            
            // Type-specific effects
            if (this.type === 'magnet') {
                // Draw magnet field lines
                ctx.globalAlpha = 0.2 * glow;
                ctx.strokeStyle = this.config.color;
                ctx.lineWidth = 2;
                for (let i = 0; i < 6; i++) {
                    const angle = (i / 6) * Math.PI * 2 + this.glowPhase * 0.5;
                    const startRadius = this.size * 0.7;
                    const endRadius = this.size * 1.2;
                    ctx.beginPath();
                    ctx.moveTo(
                        this.x + Math.cos(angle) * startRadius,
                        this.y + bob + Math.sin(angle) * startRadius
                    );
                    ctx.lineTo(
                        this.x + Math.cos(angle) * endRadius,
                        this.y + bob + Math.sin(angle) * endRadius
                    );
                    ctx.stroke();
                }
            }
            
            ctx.restore();
        }
        
        checkCollision(snake) {
            const head = snake.segments[0];
            return Vector2.distance(this, head) < this.size;
        }
    }

    // ============================================================================
    // INITIALIZATION AND GAME LOOP
    // ============================================================================

    function init() {
        console.log('Initializing Karinca Epic Snake Game...');
        
        // Get canvas elements
        canvas = document.getElementById('gameCanvas');
        ctx = canvas.getContext('2d');
        miniMapCanvas = document.getElementById('miniMap');
        miniMapCtx = miniMapCanvas.getContext('2d');
        
        // Set canvas size
        resizeCanvas();
        
        // Initialize systems
        spatialHash = new SpatialHash(GAME_CONFIG.SPATIAL_CELL_SIZE);
        powerUpSystem = new PowerUpSystem();
        
        // Initialize object pools
        initObjectPools();
        
        // Initialize audio
        initAudio();
        
        // Initialize input handling
        initInput();
        
        // Initialize UI
        initUI();
        
        // Initialize game systems
        initGameSystems();
        
        // Start game loop
        requestAnimationFrame(gameLoop);
        
        console.log('Game initialized successfully!');
    }
    
    function initGameSystems() {
        // Initialize achievement system
        achievementSystem = new AchievementSystem();
        
        // Initialize meta progression system
        metaProgression = new MetaProgression();
        
        // Sync XP with meta progression
        gameState.totalXP = metaProgression.xp;
        gameState.xp = metaProgression.xp;
    }
    
    function initObjectPools() {
        objectPools.particles = new ObjectPool(
            () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1000, color: '#fff', size: 2 }),
            (p) => { p.life = 0; p.maxLife = 1000; },
            100
        );
        
        objectPools.foods = new ObjectPool(
            () => new Food(0, 0),
            (f) => { f.age = 0; f.type = 'normal'; f.value = 1; },
            50
        );
    }
    
    function initAudio() {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('Web Audio API not supported');
        }
    }
    
    function initInput() {
        // Mouse input
        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            input.mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
            input.mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
        });
        
        // Keyboard input
        document.addEventListener('keydown', (e) => {
            input.keys[e.code] = true;
            
            if (e.code === 'Space') {
                e.preventDefault();
                input.sprint = true;
            }
        });
        
        document.addEventListener('keyup', (e) => {
            input.keys[e.code] = false;
            
            if (e.code === 'Space') {
                input.sprint = false;
            }
        });
        
        // Touch input for mobile
        initTouchInput();
    }
    
    function initTouchInput() {
        const joystick = document.getElementById('joystick');
        const joystickKnob = document.getElementById('joystickKnob');
        const sprintBtn = document.getElementById('sprintBtn');
        
        // Joystick handling
        let joystickActive = false;
        let joystickCenter = { x: 0, y: 0 };
        const maxDistance = 30;
        
        function startJoystick(e) {
            joystickActive = true;
            const rect = joystick.getBoundingClientRect();
            joystickCenter.x = rect.left + rect.width / 2;
            joystickCenter.y = rect.top + rect.height / 2;
            updateJoystick(e);
            e.preventDefault();
        }
        
        function updateJoystick(e) {
            if (!joystickActive) return;
            
            const touch = e.touches ? e.touches[0] : e;
            const dx = touch.clientX - joystickCenter.x;
            const dy = touch.clientY - joystickCenter.y;
            const distance = Math.min(Math.sqrt(dx * dx + dy * dy), maxDistance);
            const angle = Math.atan2(dy, dx);
            
            const knobX = Math.cos(angle) * distance;
            const knobY = Math.sin(angle) * distance;
            
            joystickKnob.style.transform = `translate(${knobX}px, ${knobY}px)`;
            
            if (distance > 10) {
                input.mouse.x = canvas.width / 2 + knobX * 10;
                input.mouse.y = canvas.height / 2 + knobY * 10;
            }
        }
        
        function endJoystick() {
            joystickActive = false;
            joystickKnob.style.transform = 'translate(0, 0)';
        }
        
        joystick.addEventListener('touchstart', startJoystick);
        joystick.addEventListener('mousedown', startJoystick);
        document.addEventListener('touchmove', updateJoystick);
        document.addEventListener('mousemove', updateJoystick);
        document.addEventListener('touchend', endJoystick);
        document.addEventListener('mouseup', endJoystick);
        
        // Sprint button
        sprintBtn.addEventListener('touchstart', () => input.sprint = true);
        sprintBtn.addEventListener('mousedown', () => input.sprint = true);
        sprintBtn.addEventListener('touchend', () => input.sprint = false);
        sprintBtn.addEventListener('mouseup', () => input.sprint = false);
    }
    
    function initUI() {
        // Main menu buttons
        document.getElementById('startBtn').addEventListener('click', startGame);
        document.getElementById('achievementsBtn').addEventListener('click', () => showAchievements());
        document.getElementById('upgradesBtn').addEventListener('click', () => showUpgrades());
        document.getElementById('settingsStartBtn').addEventListener('click', () => showOverlay('settingsScreen'));
        
        // Game control buttons
        document.getElementById('pauseBtn').addEventListener('click', togglePause);
        document.getElementById('resumeBtn').addEventListener('click', togglePause);
        document.getElementById('retryBtn').addEventListener('click', startGame);
        document.getElementById('nextLevelBtn').addEventListener('click', nextLevel);
        document.getElementById('mainMenuBtn').addEventListener('click', () => showOverlay('startScreen'));
        document.getElementById('mainMenuGameOverBtn').addEventListener('click', () => showOverlay('startScreen'));
        
        // Overlay close buttons
        document.getElementById('closeAchievementsBtn').addEventListener('click', () => showOverlay('startScreen'));
        document.getElementById('closeUpgradesBtn').addEventListener('click', () => showOverlay('startScreen'));
        document.getElementById('closeSettingsBtn').addEventListener('click', () => showOverlay('startScreen'));
        
        // Level complete/game over upgrade buttons
        document.getElementById('upgradesCompleteBtn').addEventListener('click', () => showUpgrades());
        document.getElementById('upgradesGameOverBtn').addEventListener('click', () => showUpgrades());
        
        // Settings change handlers
        document.getElementById('audioVolume').addEventListener('change', (e) => {
            audioSettings.volume = e.target.value / 100;
        });
    }
    
    function resizeCanvas() {
        const container = document.body;
        const aspectRatio = GAME_CONFIG.CANVAS_WIDTH / GAME_CONFIG.CANVAS_HEIGHT;
        
        let width = window.innerWidth;
        let height = window.innerHeight;
        
        if (width / height > aspectRatio) {
            width = height * aspectRatio;
        } else {
            height = width / aspectRatio;
        }
        
        canvas.width = GAME_CONFIG.CANVAS_WIDTH;
        canvas.height = GAME_CONFIG.CANVAS_HEIGHT;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        
        // Center canvas
        canvas.style.position = 'absolute';
        canvas.style.left = '50%';
        canvas.style.top = '50%';
        canvas.style.transform = 'translate(-50%, -50%)';
        
        // Mini-map
        miniMapCanvas.width = 150;
        miniMapCanvas.height = 150;
    }

    // ============================================================================
    // GAME LOGIC
    // ============================================================================
    
    function startGame() {
        gameState.current = 'playing';
        gameState.level = 1;
        gameState.lives = 3;
        gameState.score = 0;
        gameState.startTime = Date.now();
        
        initLevel();
        hideAllOverlays();
        updateHUD();
    }
    
    function initLevel() {
        // Clear existing entities
        bots = [];
        foods = [];
        particles = [];
        powerUps = [];
        
        // Create player
        player = new Snake(canvas.width / 2, canvas.height / 2, true);
        player.length = metaProgression.getStartLength();
        
        // Create bots based on level (ensure safe distance from player)
        const botCount = Math.min(2 + Math.floor(gameState.level / 3), 8);
        const playerPos = { x: canvas.width / 2, y: canvas.height / 2 };
        const minDistance = 200; // Minimum distance from player
        
        for (let i = 0; i < botCount; i++) {
            let x, y, attempts = 0;
            
            // Try to find a safe spawn position
            do {
                x = Math.random() * (canvas.width - 100) + 50;
                y = Math.random() * (canvas.height - 100) + 50;
                attempts++;
            } while (Vector2.distance({ x, y }, playerPos) < minDistance && attempts < 20);
            
            const bot = new Snake(x, y, false);
            bot.speed = GAME_CONFIG.BASE_SPEED * (0.8 + gameState.level * 0.02);
            bots.push(bot);
        }
        
        // Create initial food (avoid player area)
        for (let i = 0; i < 20; i++) {
            createFood();
        }
        
        // Spawn a test power-up for demonstration
        powerUpSystem.spawnPowerUp();
        
        gameState.levelTime = Date.now();
    }
    
    function createFood(x, y, type = 'normal') {
        if (!x || !y) {
            // Avoid spawning food too close to player
            const playerPos = player ? player.segments[0] : { x: canvas.width / 2, y: canvas.height / 2 };
            const minDistance = 80;
            let attempts = 0;
            
            do {
                x = Math.random() * (canvas.width - 100) + 50;
                y = Math.random() * (canvas.height - 100) + 50;
                attempts++;
            } while (Vector2.distance({ x, y }, playerPos) < minDistance && attempts < 10);
        }
        
        const food = new Food(x, y, type);
        foods.push(food);
        
        // Limit food count
        if (foods.length > GAME_CONFIG.MAX_FOOD_ITEMS) {
            foods.shift();
        }
    }
    
    function gameLoop(currentTime) {
        // Calculate delta time
        if (lastTime === 0) lastTime = currentTime;
        let deltaTime = Math.min(currentTime - lastTime, GAME_CONFIG.MAX_DELTA_TIME);
        lastTime = currentTime;
        
        // Handle hit pause effect
        if (hitPauseTimer > 0) {
            hitPauseTimer -= deltaTime;
            timeScale = 0.1; // Slow down time during hit pause
        } else {
            timeScale = 1.0;
        }
        
        // Apply time scale to delta time
        deltaTime *= timeScale;
        
        // Update screen shake
        updateScreenShake(deltaTime);
        
        // Fixed timestep update
        accumulator += deltaTime;
        
        while (accumulator >= fixedTimeStep) {
            if (gameState.current === 'playing' && !gameState.isPaused) {
                update(fixedTimeStep);
            }
            accumulator -= fixedTimeStep;
        }
        
        // Render with interpolation
        const interpolation = accumulator / fixedTimeStep;
        render(interpolation);
        
        requestAnimationFrame(gameLoop);
    }
    
    function update(deltaTime) {
        // Update spatial hash
        spatialHash.clear();
        
        // Update player
        if (player && !player.isDead) {
            updatePlayerInput();
            player.update(deltaTime);
            spatialHash.insert(player, player.segments[0].x, player.segments[0].y);
        }
        
        // Update bots
        bots = bots.filter(bot => {
            if (!bot.isDead) {
                bot.update(deltaTime);
                spatialHash.insert(bot, bot.segments[0].x, bot.segments[0].y);
                return true;
            }
            return false;
        });
        
        // Update foods
        foods = foods.filter(food => {
            const shouldKeep = food.update(deltaTime);
            if (shouldKeep) {
                spatialHash.insert(food, food.x, food.y);
            }
            return shouldKeep;
        });
        
        // Update power-ups
        powerUps.forEach(powerUp => {
            powerUp.update(deltaTime);
            spatialHash.insert(powerUp, powerUp.x, powerUp.y);
        });
        
        // Update particles
        particles.forEach(particle => {
            particle.life -= deltaTime;
            particle.x += particle.vx * (deltaTime / 1000);
            particle.y += particle.vy * (deltaTime / 1000);
            
            // Apply gravity if present
            if (particle.gravity) {
                particle.vy += particle.gravity * (deltaTime / 1000);
            }
            
            // Add some drag
            particle.vx *= 0.98;
            particle.vy *= 0.98;
        });
        particles = particles.filter(p => p.life > 0);
        
        // Update systems
        powerUpSystem.update(deltaTime);
        
        // Update UI
        updatePowerUpUI();
        
        // Update camera
        updateCamera(deltaTime);
        
        // Check collisions
        checkCollisions();
        
        // Spawn food periodically
        if (Math.random() < 0.01 && foods.length < 30) {
            createFood();
        }
        
        // Check win condition
        if (player && player.length >= getLevelGoal()) {
            completeLevel();
        }
        
        // Check loss condition
        if (player && player.isDead) {
            gameState.lives--;
            if (gameState.lives <= 0) {
                gameOver();
            } else {
                respawnPlayer();
            }
        }
    }
    
    function updatePlayerInput() {
        if (!player || player.isDead) return;
        
        // Mouse/touch direction
        const head = player.segments[0];
        const dx = input.mouse.x - head.x;
        const dy = input.mouse.y - head.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 10) {
            player.targetDirection = Vector2.normalize({ x: dx, y: dy });
        }
        
        // Sprint input
        player.isSprinting = input.sprint;
    }
    
    function updateCamera(deltaTime) {
        if (!player || player.isDead) return;
        
        const head = player.segments[0];
        
        // Follow player smoothly
        const targetX = head.x - canvas.width / 2;
        const targetY = head.y - canvas.height / 2;
        
        camera.x += (targetX - camera.x) * 0.1;
        camera.y += (targetY - camera.y) * 0.1;
        
        // Sprint zoom effect
        const targetScale = player.isSprinting ? GAME_CONFIG.SPRINT_ZOOM_SCALE : 1;
        camera.scale += (targetScale - camera.scale) * GAME_CONFIG.ZOOM_EASING;
        
        // Apply screen shake to camera
        camera.shake.x = screenShake.x;
        camera.shake.y = screenShake.y;
    }
    
    function updateScreenShake(deltaTime) {
        if (screenShake.intensity > 0) {
            screenShake.duration -= deltaTime;
            
            if (screenShake.duration <= 0) {
                screenShake.intensity = 0;
                screenShake.x = 0;
                screenShake.y = 0;
            } else {
                // Generate random shake offset
                const shakeAmount = screenShake.intensity * (screenShake.duration / 300); // Fade over 300ms
                screenShake.x = (Math.random() - 0.5) * shakeAmount;
                screenShake.y = (Math.random() - 0.5) * shakeAmount;
            }
        }
    }
    
    function checkCollisions() {
        if (!player || player.isDead) return;
        
        // Food collection
        foods.forEach((food, index) => {
            if (food.checkCollision(player)) {
                player.grow(food.value);
                gameState.score += food.value * 10;
                
                // Enhanced effects based on food type
                let shakeIntensity = GAME_CONFIG.SCREEN_SHAKE.FOOD;
                let pauseDuration = GAME_CONFIG.HIT_PAUSE.FOOD;
                
                if (food.type === 'bonus') {
                    shakeIntensity *= 1.5;
                    pauseDuration *= 1.5;
                } else if (food.type === 'death') {
                    shakeIntensity *= 0.8;
                    pauseDuration *= 0.8;
                }
                
                addScreenShake(shakeIntensity, 200);
                addHitPause(pauseDuration);
                playSound('eat');
                
                // Create particles
                createParticles(food.x, food.y, food.color, 5);
                
                foods.splice(index, 1);
                updateHUD();
            }
        });
        
        // Power-up collection
        powerUps.forEach((powerUp, index) => {
            if (powerUp.checkCollision(player)) {
                player.addPowerUp(powerUp.type, powerUp.config.duration);
                
                // Achievement: power-up collected
                achievementSystem.checkPowerUpCollected();
                
                // Enhanced power-up effects
                addScreenShake(GAME_CONFIG.SCREEN_SHAKE.POWER_UP, 250);
                addHitPause(GAME_CONFIG.HIT_PAUSE.POWER_UP);
                playSound('powerup');
                
                createParticles(powerUp.x, powerUp.y, powerUp.config.color, 12);
                
                powerUps.splice(index, 1);
                updatePowerUpUI();
            }
        });
        
        // Snake collisions
        bots.forEach(bot => {
            if (player.checkCollision(bot)) {
                player.kill();
            }
            
            // Bot vs bot collisions
            bots.forEach(otherBot => {
                if (bot !== otherBot && bot.checkCollision(otherBot)) {
                    bot.kill();
                }
            });
        });
        
        // Self collision
        for (let i = 6; i < player.segments.length; i++) { // Increased minimum distance for self-collision
            const segment = player.segments[i];
            if (Vector2.distance(player.segments[0], segment) < GAME_CONFIG.GRID_SIZE * 0.6) {
                player.kill();
                break;
            }
        }
    }
    
    function render(interpolation) {
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        ctx.save();
        
        // Apply camera transform
        ctx.scale(camera.scale, camera.scale);
        ctx.translate(-camera.x + camera.shake.x, -camera.y + camera.shake.y);
        
        // Draw foods
        foods.forEach(food => food.draw(ctx));
        
        // Draw power-ups
        powerUps.forEach(powerUp => powerUp.draw(ctx));
        
        // Draw particles
        particles.forEach(particle => {
            ctx.save();
            const alpha = particle.life / particle.maxLife;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = particle.color;
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
        
        // Draw snakes
        if (player && !player.isDead) {
            player.draw(ctx, interpolation);
        }
        
        bots.forEach(bot => {
            if (!bot.isDead) {
                bot.draw(ctx, interpolation);
            }
        });
        
        ctx.restore();
        
        // Draw UI elements
        renderMiniMap();
    }
    
    function renderMiniMap() {
        miniMapCtx.clearRect(0, 0, miniMapCanvas.width, miniMapCanvas.height);
        
        const scaleX = miniMapCanvas.width / canvas.width;
        const scaleY = miniMapCanvas.height / canvas.height;
        
        // Draw player
        if (player && !player.isDead) {
            miniMapCtx.fillStyle = '#4fc3f7';
            miniMapCtx.fillRect(
                player.segments[0].x * scaleX - 2,
                player.segments[0].y * scaleY - 2,
                4, 4
            );
        }
        
        // Draw bots
        miniMapCtx.fillStyle = '#ff5722';
        bots.forEach(bot => {
            if (!bot.isDead) {
                miniMapCtx.fillRect(
                    bot.segments[0].x * scaleX - 1,
                    bot.segments[0].y * scaleY - 1,
                    2, 2
                );
            }
        });
        
        // Draw food clusters
        miniMapCtx.fillStyle = '#4caf50';
        foods.forEach(food => {
            miniMapCtx.fillRect(
                food.x * scaleX,
                food.y * scaleY,
                1, 1
            );
        });
        
        // Draw power-ups
        miniMapCtx.fillStyle = '#ffeb3b';
        powerUps.forEach(powerUp => {
            miniMapCtx.fillRect(
                powerUp.x * scaleX - 1,
                powerUp.y * scaleY - 1,
                2, 2
            );
        });
    }

    // ============================================================================
    // UTILITY FUNCTIONS
    // ============================================================================
    
    function addScreenShake(intensity, duration = 300) {
        screenShake.intensity = Math.max(screenShake.intensity, intensity);
        screenShake.duration = Math.max(screenShake.duration, duration);
    }
    
    function addHitPause(duration) {
        hitPauseTimer = Math.max(hitPauseTimer, duration);
    }
    
    function createParticles(x, y, color, count, options = {}) {
        const {
            speed = 200,
            spread = Math.PI * 2,
            life = 1000,
            size = 2,
            gravity = 0
        } = options;
        
        for (let i = 0; i < count; i++) {
            const particle = objectPools.particles.get();
            particle.x = x + (Math.random() - 0.5) * 10;
            particle.y = y + (Math.random() - 0.5) * 10;
            
            const angle = Math.random() * spread;
            const velocity = speed * (0.5 + Math.random() * 0.5);
            particle.vx = Math.cos(angle) * velocity;
            particle.vy = Math.sin(angle) * velocity;
            
            particle.life = particle.maxLife = life * (0.8 + Math.random() * 0.4);
            particle.color = color;
            particle.size = size + Math.random() * 3;
            particle.gravity = gravity;
            particles.push(particle);
        }
        
        // Limit particle count
        if (particles.length > GAME_CONFIG.MAX_PARTICLES) {
            const excess = particles.splice(0, particles.length - GAME_CONFIG.MAX_PARTICLES);
            excess.forEach(p => objectPools.particles.release(p));
        }
    }
    
    function playSound(type) {
        if (!audioContext || audioSettings.volume === 0) return;
        
        try {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            let frequency, duration, waveType = 'square';
            const baseVolume = audioSettings.volume * 0.1;
            
            switch (type) {
                case 'eat':
                    frequency = 660;
                    duration = 0.15;
                    waveType = 'sine';
                    // Add frequency sweep for more appealing sound
                    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
                    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.5, audioContext.currentTime + 0.05);
                    break;
                case 'powerup':
                    frequency = 880;
                    duration = 0.3;
                    waveType = 'square';
                    // Power-up chord progression
                    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
                    oscillator.frequency.setValueAtTime(frequency * 1.25, audioContext.currentTime + 0.1);
                    oscillator.frequency.setValueAtTime(frequency * 1.5, audioContext.currentTime + 0.2);
                    break;
                case 'kill':
                    frequency = 220;
                    duration = 0.4;
                    waveType = 'sawtooth';
                    // Descending sound for enemy death
                    oscillator.frequency.setValueAtTime(frequency * 2, audioContext.currentTime);
                    oscillator.frequency.exponentialRampToValueAtTime(frequency, audioContext.currentTime + duration);
                    break;
                case 'death':
                    frequency = 110;
                    duration = 0.8;
                    waveType = 'square';
                    // Dramatic death sound
                    oscillator.frequency.setValueAtTime(frequency * 3, audioContext.currentTime);
                    oscillator.frequency.exponentialRampToValueAtTime(frequency, audioContext.currentTime + duration);
                    break;
                case 'levelup':
                    frequency = 523; // C5
                    duration = 0.5;
                    waveType = 'sine';
                    // Victory fanfare
                    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
                    oscillator.frequency.setValueAtTime(frequency * 1.33, audioContext.currentTime + 0.1); // F5
                    oscillator.frequency.setValueAtTime(frequency * 1.5, audioContext.currentTime + 0.2); // G5
                    oscillator.frequency.setValueAtTime(frequency * 2, audioContext.currentTime + 0.3); // C6
                    break;
                default:
                    frequency = 440;
                    duration = 0.1;
                    waveType = 'sine';
            }
            
            oscillator.type = waveType;
            gainNode.gain.setValueAtTime(baseVolume, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + duration);
        } catch (e) {
            console.warn('Audio playback failed:', e);
        }
    }
    
    function getLevelGoal() {
        return 50 + gameState.level * 5;
    }
    
    function completeLevel() {
        gameState.current = 'levelComplete';
        const levelTime = (Date.now() - gameState.levelTime) / 1000;
        const baseXP = 100 + gameState.level * 10 + player.length;
        let xpEarned = Math.floor(baseXP);
        
        // Bonus XP for fast completion
        if (levelTime < 30) {
            xpEarned = Math.floor(xpEarned * 1.5);
        }
        
        gameState.xp += xpEarned;
        gameState.totalXP += xpEarned;
        metaProgression.addXP(xpEarned);
        
        // Achievement checks
        achievementSystem.checkLevelComplete(gameState.level);
        
        // Celebration effects
        addScreenShake(8, 500);
        playSound('levelup');
        
        // Create celebration particles around player
        if (player && !player.isDead) {
            createParticles(player.segments[0].x, player.segments[0].y, '#ffeb3b', 30, {
                speed: 300,
                life: 2000,
                size: 4
            });
            createParticles(player.segments[0].x, player.segments[0].y, '#4caf50', 20, {
                speed: 250,
                life: 1500,
                size: 3
            });
        }
        
        // Update UI
        document.getElementById('finalLength').textContent = Math.floor(player.length);
        document.getElementById('xpEarned').textContent = xpEarned;
        document.getElementById('levelTime').textContent = levelTime.toFixed(1) + 's';
        
        showOverlay('levelCompleteScreen');
        updateHUD();
    }
    
    function nextLevel() {
        gameState.level++;
        if (gameState.level > 99) {
            gameComplete();
        } else {
            gameState.current = 'playing';
            initLevel();
            hideAllOverlays();
            updateHUD();
        }
    }
    
    function gameOver() {
        gameState.current = 'gameOver';
        
        // Update UI
        document.getElementById('maxLevel').textContent = gameState.level;
        document.getElementById('totalXP').textContent = gameState.totalXP;
        document.getElementById('bestLength').textContent = Math.floor(player ? player.length : 5);
        
        showOverlay('gameOverScreen');
    }
    
    function gameComplete() {
        gameState.current = 'gameComplete';
        gameState.isGameComplete = true;
        
        // Update UI
        document.getElementById('finalTotalXP').textContent = gameState.totalXP;
        document.getElementById('finalAchievements').textContent = achievementSystem.getUnlockedCount();
        
        showOverlay('gameCompleteScreen');
    }
    
    function respawnPlayer() {
        // Reset player
        player = new Snake(canvas.width / 2, canvas.height / 2, true);
        player.length = metaProgression.getStartLength();
        gameState.current = 'playing';
        updateHUD();
    }
    
    function togglePause() {
        if (gameState.current === 'playing') {
            gameState.isPaused = !gameState.isPaused;
            if (gameState.isPaused) {
                showOverlay('pauseScreen');
            } else {
                hideAllOverlays();
            }
        }
    }

    // ============================================================================
    // UI FUNCTIONS
    // ============================================================================
    
    function updateHUD() {
        document.getElementById('levelDisplay').textContent = gameState.level;
        document.getElementById('goalDisplay').textContent = getLevelGoal();
        document.getElementById('lengthDisplay').textContent = player ? Math.floor(player.length) : 0;
        document.getElementById('livesDisplay').textContent = gameState.lives;
    }
    
    function showAchievements() {
        const container = document.getElementById('achievementsList');
        container.innerHTML = '';
        
        Object.values(achievementSystem.achievements).forEach(achievement => {
            const div = document.createElement('div');
            div.className = `achievement-item ${achievement.unlocked ? 'unlocked' : ''}`;
            
            const progress = achievement.unlocked ? achievement.target : achievement.progress;
            const progressText = achievement.target > 1 ? ` (${progress}/${achievement.target})` : '';
            
            div.innerHTML = `
                <span class="achievement-icon">${achievement.icon}</span>
                <div class="achievement-info">
                    <div class="achievement-name">${achievement.name}${progressText}</div>
                    <div class="achievement-desc">${achievement.description}</div>
                </div>
            `;
            
            container.appendChild(div);
        });
        
        showOverlay('achievementsScreen');
    }
    
    function showUpgrades() {
        updateUpgradesUI();
        showOverlay('upgradesScreen');
    }
    
    function updateUpgradesUI() {
        const container = document.getElementById('upgradesList');
        const xpDisplay = document.getElementById('currentXP');
        
        // Sync XP display with both game state and meta progression
        const currentXP = Math.max(gameState.xp, metaProgression.xp);
        xpDisplay.textContent = currentXP;
        container.innerHTML = '';
        
        Object.values(metaProgression.upgrades).forEach(upgrade => {
            const div = document.createElement('div');
            div.className = 'upgrade-item';
            
            const cost = metaProgression.getCost(upgrade.id);
            const currentValue = metaProgression.getCurrentValue(upgrade.id);
            const nextValue = upgrade.baseValue + (upgrade.increment * (upgrade.currentLevel + 1));
            const isMaxLevel = metaProgression.isMaxLevel(upgrade.id);
            const canAfford = currentXP >= cost;
            
            let buttonContent;
            if (isMaxLevel) {
                buttonContent = '<button class="upgrade-btn" disabled>MAX</button>';
            } else if (!canAfford) {
                buttonContent = `<button class="upgrade-btn" disabled>Need ${cost} XP</button>`;
            } else {
                buttonContent = `<button class="upgrade-btn" onclick="buyUpgrade('${upgrade.id}')">Buy (${cost} XP)</button>`;
            }
            
            let valueDisplay;
            if (upgrade.id === 'startLength') {
                valueDisplay = `${Math.floor(currentValue)}`;
            } else if (upgrade.id === 'baseSpeed') {
                valueDisplay = `+${Math.floor((currentValue - 1) * 100)}%`;
            } else if (upgrade.id === 'sprintEfficiency') {
                valueDisplay = `${Math.floor((1 - metaProgression.getSprintEfficiency()) * 100)}% less drain`;
            } else if (upgrade.id === 'foodValue') {
                valueDisplay = `+${Math.floor((currentValue - 1) * 100)}%`;
            }
            
            div.innerHTML = `
                <div class="upgrade-info">
                    <div class="upgrade-name">${upgrade.icon} ${upgrade.name}</div>
                    <div class="upgrade-desc">${upgrade.description}</div>
                    <div class="upgrade-level">Level ${upgrade.currentLevel}/${upgrade.maxLevel} - ${valueDisplay}</div>
                </div>
                ${buttonContent}
            `;
            
            container.appendChild(div);
        });
    }
    
    // Global function for upgrade buttons
    window.buyUpgrade = function(upgradeId) {
        if (metaProgression.buyUpgrade(upgradeId)) {
            updateUpgradesUI();
            playSound('powerup'); // Reuse power-up sound for purchase
        }
    };
    
    function updatePowerUpUI() {
        const container = document.getElementById('powerUpTimers');
        container.innerHTML = '';
        
        if (player && player.powerUps.size > 0) {
            player.powerUps.forEach((powerUp, type) => {
                const config = powerUpSystem.types[type];
                const timeLeft = Math.ceil(powerUp.timeLeft / 1000);
                const percentage = (powerUp.timeLeft / config.duration) * 100;
                
                const div = document.createElement('div');
                div.className = `power-up-timer ${type}`;
                
                div.innerHTML = `
                    <div class="timer-bg" style="width: ${percentage}%"></div>
                    <span class="timer-icon">${config.icon}</span>
                    <span class="timer-text">${timeLeft}s</span>
                `;
                
                // Add pulsing effect when time is running low
                if (timeLeft <= 3) {
                    div.style.animation = 'pulse 0.5s infinite alternate';
                }
                
                container.appendChild(div);
            });
            
            // Show the power-up container
            container.style.display = 'flex';
        } else {
            // Hide the power-up container when no power-ups are active
            container.style.display = 'none';
        }
    }
    
    function showOverlay(id) {
        hideAllOverlays();
        document.getElementById(id).classList.remove('hidden');
    }
    
    function hideAllOverlays() {
        const overlays = document.querySelectorAll('.overlay');
        overlays.forEach(overlay => overlay.classList.add('hidden'));
    }
    
    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================
    
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('blur', () => {
        if (gameState.current === 'playing') {
            togglePause();
        }
    });
    
    // Prevent context menu on right click
    document.addEventListener('contextmenu', e => e.preventDefault());
    
    // ============================================================================
    // INITIALIZATION
    // ============================================================================
    
    // Start the game when DOM is loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();