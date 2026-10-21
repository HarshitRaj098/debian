#ifndef PROCESS_H
#define PROCESS_H

#include <stdint.h>
#include "entitlement.h"

typedef enum {
    PROC_STATE_READY,
    PROC_STATE_RUNNING,
    PROC_STATE_BLOCKED,
    PROC_STATE_TERMINATED
} proc_state_t;

typedef struct {
    uint8_t pid;
    proc_state_t state;
    uint32_t memory_base;
    uint32_t memory_limit;
    uint32_t cpu_time;
    capability_t required_capability; // Entitlement linkage
    char name[16];
} pcb_t;

#define MAX_PROCESSES 8

void process_init(void);
int process_spawn(const char *name, capability_t cap);
pcb_t* process_get_current(void);

#endif
