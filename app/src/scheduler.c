#include "scheduler.h"
#include "entitlement.h"
#include <zephyr/logging/log.h>

LOG_MODULE_REGISTER(os_sched, LOG_LEVEL_INF);

void scheduler_init(void) {
    LOG_INF("Scheduler active.");
}

void scheduler_tick(void) {
    // Basic Round-Robin foundation
    pcb_t* current = process_get_current();
    
    // In a real system, this would trigger a context switch
    // Here we check if the current process still has entitlement
    if (current->pid != 0) { // If not kernel
        if (!entitlement_has_capability(current->required_capability)) {
            LOG_WRN("Process %s lost entitlement. Terminating.", current->name);
            current->state = PROC_STATE_TERMINATED;
        }
    }
}
