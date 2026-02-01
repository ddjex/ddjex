/**
 * ddjex Animation System
 * Enter/exit animations, spring physics, and transitions
 */

/**
 * Spring physics simulation
 * Based on damped harmonic oscillator
 */
class Spring {
  constructor(config = {}) {
    this.stiffness = config.stiffness ?? 100;
    this.damping = config.damping ?? 10;
    this.mass = config.mass ?? 1;
    this.velocity = config.velocity ?? 0;
    this.precision = config.precision ?? 0.01;
  }

  /**
   * Calculate spring position at time t
   * Returns { value, velocity, done }
   */
  step(from, to, velocity, dt) {
    const displacement = from - to;

    // Spring force: F = -k * x
    const springForce = -this.stiffness * displacement;

    // Damping force: F = -c * v
    const dampingForce = -this.damping * velocity;

    // Acceleration: a = F / m
    const acceleration = (springForce + dampingForce) / this.mass;

    // Update velocity and position
    const newVelocity = velocity + acceleration * dt;
    const newValue = from + newVelocity * dt;

    // Check if spring is at rest
    const done = Math.abs(newValue - to) < this.precision &&
                 Math.abs(newVelocity) < this.precision;

    return {
      value: done ? to : newValue,
      velocity: done ? 0 : newVelocity,
      done
    };
  }
}

/**
 * Easing functions
 */
const Easings = {
  linear: t => t,
  ease: t => t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2,
  'ease-in': t => t * t * t,
  'ease-out': t => 1 - Math.pow(1 - t, 3),
  'ease-in-out': t => t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2,

  // Additional useful easings
  'ease-in-quad': t => t * t,
  'ease-out-quad': t => 1 - (1 - t) * (1 - t),
  'ease-in-out-quad': t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,

  'ease-in-cubic': t => t * t * t,
  'ease-out-cubic': t => 1 - Math.pow(1 - t, 3),
  'ease-in-out-cubic': t => t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2,

  'ease-in-elastic': t => t === 0 ? 0 : t === 1 ? 1
    : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3)),
  'ease-out-elastic': t => t === 0 ? 0 : t === 1 ? 1
    : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,

  'ease-out-bounce': t => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) {
      return n1 * t * t;
    } else if (t < 2 / d1) {
      return n1 * (t -= 1.5 / d1) * t + 0.75;
    } else if (t < 2.5 / d1) {
      return n1 * (t -= 2.25 / d1) * t + 0.9375;
    } else {
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    }
  }
};

/**
 * Animation controller using Web Animations API
 */
class AnimationController {
  constructor() {
    this.animations = new Map();
    this.springs = new Map();
  }

  /**
   * Create animation from config
   */
  createAnimation(element, config) {
    const { from, to, keyframes, duration = 300, delay = 0, easing = 'ease', fill = 'forwards', iterations = 1, direction = 'normal' } = config;

    let animationKeyframes;

    if (keyframes && keyframes.length > 0) {
      // Use provided keyframes
      animationKeyframes = keyframes.map(kf => {
        const frame = { ...kf.style };
        if (kf.offset !== undefined) {
          frame.offset = kf.offset;
        }
        if (kf.easing) {
          frame.easing = this.getEasingString(kf.easing);
        }
        return frame;
      });
    } else if (from && to) {
      // Create from/to keyframes
      animationKeyframes = [from, to];
    } else if (to) {
      // Animate to target
      animationKeyframes = [to];
    } else {
      return null;
    }

    const options = {
      duration,
      delay,
      easing: this.getEasingString(easing),
      fill,
      iterations,
      direction
    };

    return element.animate(animationKeyframes, options);
  }

  /**
   * Get CSS easing string from easing name
   */
  getEasingString(easing) {
    const easingMap = {
      'linear': 'linear',
      'ease': 'ease',
      'ease-in': 'ease-in',
      'ease-out': 'ease-out',
      'ease-in-out': 'ease-in-out',
      'spring': 'cubic-bezier(0.175, 0.885, 0.32, 1.275)'
    };
    return easingMap[easing] || easing;
  }

  /**
   * Run enter animation
   */
  async enter(element, config) {
    const defaultEnter = {
      from: { opacity: 0, transform: 'translateY(-10px)' },
      to: { opacity: 1, transform: 'translateY(0)' },
      duration: 300,
      easing: 'ease-out'
    };

    const animConfig = { ...defaultEnter, ...config };

    if (animConfig.spring) {
      return this.springAnimate(element, animConfig);
    }

    const animation = this.createAnimation(element, animConfig);
    if (animation) {
      await animation.finished;
    }
    return animation;
  }

  /**
   * Run exit animation
   */
  async exit(element, config) {
    const defaultExit = {
      from: { opacity: 1, transform: 'translateY(0)' },
      to: { opacity: 0, transform: 'translateY(10px)' },
      duration: 300,
      easing: 'ease-in'
    };

    const animConfig = { ...defaultExit, ...config };

    if (animConfig.spring) {
      return this.springAnimate(element, animConfig);
    }

    const animation = this.createAnimation(element, animConfig);
    if (animation) {
      await animation.finished;
    }
    return animation;
  }

  /**
   * Spring-based animation
   */
  async springAnimate(element, config) {
    const { from = {}, to = {}, spring: springConfig = {} } = config;
    const spring = new Spring(springConfig);

    return new Promise((resolve) => {
      const properties = Object.keys(to);
      const state = {};

      // Initialize state
      for (const prop of properties) {
        const fromVal = this.parseValue(from[prop] || getComputedStyle(element)[prop]);
        const toVal = this.parseValue(to[prop]);
        state[prop] = {
          current: fromVal.value,
          target: toVal.value,
          velocity: springConfig.velocity || 0,
          unit: toVal.unit || fromVal.unit || ''
        };
      }

      let lastTime = performance.now();
      const frameRate = 1000 / 60; // 60fps

      const tick = () => {
        const now = performance.now();
        const dt = Math.min((now - lastTime) / 1000, 0.1); // Cap delta time
        lastTime = now;

        let allDone = true;

        for (const prop of properties) {
          const propState = state[prop];
          const result = spring.step(
            propState.current,
            propState.target,
            propState.velocity,
            dt
          );

          propState.current = result.value;
          propState.velocity = result.velocity;

          // Apply to element
          element.style[prop] = `${result.value}${propState.unit}`;

          if (!result.done) {
            allDone = false;
          }
        }

        if (allDone) {
          resolve();
        } else {
          requestAnimationFrame(tick);
        }
      };

      requestAnimationFrame(tick);
    });
  }

  /**
   * Parse CSS value into number and unit
   */
  parseValue(value) {
    if (typeof value === 'number') {
      return { value, unit: '' };
    }
    if (typeof value !== 'string') {
      return { value: 0, unit: '' };
    }

    const match = value.match(/^(-?[\d.]+)(.*)$/);
    if (match) {
      return {
        value: parseFloat(match[1]),
        unit: match[2] || ''
      };
    }

    return { value: 0, unit: '' };
  }

  /**
   * Interpolate between two values
   */
  interpolate(from, to, progress, easing = 'linear') {
    const easingFn = Easings[easing] || Easings.linear;
    const t = easingFn(progress);

    if (typeof from === 'number' && typeof to === 'number') {
      return from + (to - from) * t;
    }

    // String interpolation (e.g., colors, transforms)
    const fromParsed = this.parseValue(from);
    const toParsed = this.parseValue(to);

    const value = fromParsed.value + (toParsed.value - fromParsed.value) * t;
    return `${value}${toParsed.unit || fromParsed.unit}`;
  }

  /**
   * Cancel animation
   */
  cancel(element) {
    const animation = this.animations.get(element);
    if (animation) {
      animation.cancel();
      this.animations.delete(element);
    }
  }

  /**
   * Cleanup
   */
  dispose() {
    for (const animation of this.animations.values()) {
      animation.cancel();
    }
    this.animations.clear();
    this.springs.clear();
  }
}

/**
 * Default animation presets
 */
const AnimationPresets = {
  fadeIn: {
    from: { opacity: 0 },
    to: { opacity: 1 },
    duration: 300,
    easing: 'ease-out'
  },
  fadeOut: {
    from: { opacity: 1 },
    to: { opacity: 0 },
    duration: 300,
    easing: 'ease-in'
  },
  slideInUp: {
    from: { opacity: 0, transform: 'translateY(20px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
    duration: 300,
    easing: 'ease-out'
  },
  slideOutDown: {
    from: { opacity: 1, transform: 'translateY(0)' },
    to: { opacity: 0, transform: 'translateY(20px)' },
    duration: 300,
    easing: 'ease-in'
  },
  slideInLeft: {
    from: { opacity: 0, transform: 'translateX(-20px)' },
    to: { opacity: 1, transform: 'translateX(0)' },
    duration: 300,
    easing: 'ease-out'
  },
  slideOutRight: {
    from: { opacity: 1, transform: 'translateX(0)' },
    to: { opacity: 0, transform: 'translateX(20px)' },
    duration: 300,
    easing: 'ease-in'
  },
  scaleIn: {
    from: { opacity: 0, transform: 'scale(0.9)' },
    to: { opacity: 1, transform: 'scale(1)' },
    duration: 300,
    easing: 'ease-out'
  },
  scaleOut: {
    from: { opacity: 1, transform: 'scale(1)' },
    to: { opacity: 0, transform: 'scale(0.9)' },
    duration: 300,
    easing: 'ease-in'
  },
  bounceIn: {
    keyframes: [
      { offset: 0, opacity: 0, transform: 'scale(0.3)' },
      { offset: 0.5, opacity: 1, transform: 'scale(1.05)' },
      { offset: 0.7, transform: 'scale(0.9)' },
      { offset: 1, opacity: 1, transform: 'scale(1)' }
    ],
    duration: 500,
    easing: 'ease-out'
  },
  bounceOut: {
    keyframes: [
      { offset: 0, opacity: 1, transform: 'scale(1)' },
      { offset: 0.2, transform: 'scale(0.9)' },
      { offset: 0.5, opacity: 1, transform: 'scale(1.05)' },
      { offset: 1, opacity: 0, transform: 'scale(0.3)' }
    ],
    duration: 500,
    easing: 'ease-in'
  },
  springIn: {
    from: { opacity: 0, transform: 'scale(0.8)' },
    to: { opacity: 1, transform: 'scale(1)' },
    spring: { stiffness: 100, damping: 10 }
  },
  springOut: {
    from: { opacity: 1, transform: 'scale(1)' },
    to: { opacity: 0, transform: 'scale(0.8)' },
    spring: { stiffness: 100, damping: 15 }
  }
};

/**
 * Animation manager - singleton for global animation control
 */
let animationManager = null;

function getAnimationManager() {
  if (!animationManager) {
    animationManager = new AnimationController();
  }
  return animationManager;
}

function configureAnimationManager(config) {
  const manager = getAnimationManager();
  // Add any global configuration here
  return manager;
}

/**
 * Utility function to get preset or custom animation config
 */
function getAnimationConfig(config) {
  if (typeof config === 'string' && AnimationPresets[config]) {
    return AnimationPresets[config];
  }
  return config || {};
}

export {
  Spring,
  Easings,
  AnimationController,
  AnimationPresets,
  getAnimationManager,
  configureAnimationManager,
  getAnimationConfig
};
