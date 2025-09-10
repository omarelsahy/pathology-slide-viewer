// Worker Pool Manager
// Manages a pool of worker threads for slide conversions

const { Worker } = require('worker_threads');
const path = require('path');
const EventEmitter = require('events');

class WorkerPool extends EventEmitter {
  constructor(maxWorkers = 12, workerScript = './conversionWorker.js') {
    super();
    this.maxWorkers = maxWorkers;
    this.workerScript = path.resolve(workerScript);
    this.activeWorkers = new Map(); // workerId -> { worker, slideInfo, startTime }
    this.queue = [];
    this.workerIdCounter = 0;
    
    console.log(`WorkerPool initialized with ${maxWorkers} max workers`);
  }

  async processSlide(slideInfo, config, vipsConfig) {
    return new Promise((resolve, reject) => {
      const task = {
        slideInfo,
        config,
        vipsConfig,
        resolve,
        reject,
        id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };

      this.queue.push(task);
      this.processQueue();
    });
  }

  processQueue() {
    // Start new workers if we have tasks and available slots
    console.log(`Processing queue: ${this.queue.length} tasks waiting, ${this.activeWorkers.size}/${this.maxWorkers} workers active`);
    
    while (this.queue.length > 0 && this.activeWorkers.size < this.maxWorkers) {
      const task = this.queue.shift();
      console.log(`Starting new worker for slide: ${task.slideInfo.fileName}`);
      this.startWorker(task);
    }
    
    if (this.queue.length > 0 && this.activeWorkers.size >= this.maxWorkers) {
      console.log(`Queue has ${this.queue.length} tasks waiting for worker slots`);
    }
  }

  startWorker(task) {
    const workerId = ++this.workerIdCounter;
    
    try {
      const worker = new Worker(this.workerScript, {
        workerData: {
          slideInfo: task.slideInfo,
          config: task.config,
          vipsConfig: task.vipsConfig
        }
      });

      this.activeWorkers.set(workerId, {
        worker,
        slideInfo: task.slideInfo,
        startTime: Date.now(),
        task
      });

      console.log(`Started worker ${workerId} for slide: ${task.slideInfo.fileName}`);

      // Handle worker messages
      worker.on('message', (message) => {
        this.handleWorkerMessage(workerId, message);
      });

      // Handle worker completion
      worker.on('exit', (code) => {
        console.log(`Worker ${workerId} exited with code ${code}`);
        this.cleanupWorker(workerId);
      });

      // Handle worker errors
      worker.on('error', (error) => {
        console.error(`Worker ${workerId} error:`, error);
        const workerInfo = this.activeWorkers.get(workerId);
        if (workerInfo) {
          workerInfo.task.reject(error);
        }
        this.cleanupWorker(workerId);
      });

      // Emit worker started event
      this.emit('workerStarted', {
        workerId,
        filename: task.slideInfo.fileName,
        activeWorkers: this.activeWorkers.size,
        queueLength: this.queue.length
      });

    } catch (error) {
      console.error(`Failed to start worker for ${task.slideInfo.fileName}:`, error);
      task.reject(error);
    }
  }

  handleWorkerMessage(workerId, message) {
    const workerInfo = this.activeWorkers.get(workerId);
    if (!workerInfo) return;

    const { type, data } = message;

    switch (type) {
      case 'start':
      case 'started':
        this.emit('conversionStarted', data);
        break;
      
      case 'progress':
        this.emit('conversionProgress', data);
        break;
      
      case 'complete':
      case 'completed':
        this.emit('conversionCompleted', data);
        workerInfo.task.resolve({ success: true, ...data });
        break;
      
      case 'cancelled':
        this.emit('conversionCancelled', data);
        workerInfo.task.resolve({ success: false, cancelled: true, ...data });
        break;
      
      case 'error':
        this.emit('conversionError', data);
        workerInfo.task.reject(new Error(data.error));
        break;
      
      case 'result':
        // Final result from worker
        if (data.success) {
          workerInfo.task.resolve(data);
        } else {
          workerInfo.task.reject(new Error(data.error || 'Conversion failed'));
        }
        break;
      
      default:
        console.log(`Unknown message type from worker ${workerId}:`, type, data);
    }
  }

  cleanupWorker(workerId) {
    const workerInfo = this.activeWorkers.get(workerId);
    if (workerInfo) {
      try {
        workerInfo.worker.terminate();
      } catch (error) {
        console.error(`Error terminating worker ${workerId}:`, error);
      }
      
      this.activeWorkers.delete(workerId);
      
      this.emit('workerCompleted', {
        workerId,
        filename: workerInfo.slideInfo.fileName,
        duration: Date.now() - workerInfo.startTime,
        activeWorkers: this.activeWorkers.size,
        queueLength: this.queue.length
      });
    }

    // Process next item in queue immediately when a worker completes
    console.log(`Worker ${workerId} completed, processing queue for next task`);
    this.processQueue();
  }

  // Cancel a specific conversion
  cancelConversion(filename) {
    // Find and terminate worker processing this file
    for (const [workerId, workerInfo] of this.activeWorkers) {
      if (workerInfo.slideInfo.fileName === filename) {
        console.log(`Cancelling worker ${workerId} for ${filename}`);
        try {
          // Send termination signal to worker first
          workerInfo.worker.postMessage({ type: 'terminate' });
          
          // Force terminate after a short delay
          setTimeout(() => {
            try {
              workerInfo.worker.terminate();
            } catch (error) {
              console.error(`Error force terminating worker ${workerId}:`, error);
            }
          }, 1000);
          
          workerInfo.task.resolve({ success: false, cancelled: true });
        } catch (error) {
          console.error(`Error cancelling worker ${workerId}:`, error);
        }
        this.cleanupWorker(workerId);
        return true;
      }
    }

    // Remove from queue if not yet started
    const queueIndex = this.queue.findIndex(task => task.slideInfo.fileName === filename);
    if (queueIndex !== -1) {
      const task = this.queue.splice(queueIndex, 1)[0];
      task.resolve({ success: false, cancelled: true });
      return true;
    }

    return false;
  }

  // Get current status
  getStatus() {
    const processingFiles = Array.from(this.activeWorkers.values()).map(w => w.slideInfo.fileName);
    const processingBasenames = Array.from(this.activeWorkers.values()).map(w => w.slideInfo.baseName);
    const queuedFiles = this.queue.map(task => task.slideInfo.fileName);
    const queuedBasenames = this.queue.map(task => task.slideInfo.baseName);
    
    return {
      activeWorkers: this.activeWorkers.size,
      maxWorkers: this.maxWorkers,
      queueLength: this.queue.length,
      processingFiles: [...processingFiles, ...processingBasenames].filter(Boolean),
      queuedFiles: [...queuedFiles, ...queuedBasenames].filter(Boolean)
    };
  }

  // Update max workers dynamically
  setMaxWorkers(newMax) {
    console.log(`Updating max workers from ${this.maxWorkers} to ${newMax}`);
    this.maxWorkers = newMax;
    // Process queue in case we can start more workers now
    this.processQueue();
  }

  // Shutdown all workers
  async shutdown() {
    console.log('Shutting down worker pool...');
    
    const shutdownPromises = [];
    for (const [workerId, workerInfo] of this.activeWorkers) {
      shutdownPromises.push(
        new Promise((resolve) => {
          workerInfo.worker.once('exit', resolve);
          workerInfo.worker.terminate();
        })
      );
    }

    // Reject all queued tasks
    this.queue.forEach(task => {
      task.reject(new Error('Worker pool shutting down'));
    });
    this.queue = [];

    await Promise.all(shutdownPromises);
    this.activeWorkers.clear();
    console.log('Worker pool shutdown complete');
  }
}

module.exports = WorkerPool;
