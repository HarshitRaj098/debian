#include "process.h"
#include <zephyr/kernel.h>
#include <string.h>

static pcb_t process_table[MAX_PROCESSES];
static uint8_t current_pid = 0;

void process_init(void) {
    memset(process_table, 0, sizeof(process_table));
    // PID 0 is always the Kernel
    process_table[0].pid = 0;
    process_table[0].state = PROC_STATE_RUNNING;
    strcpy(process_table[0].name, "KERNEL");
}

int process_spawn(const char *name, capability_t cap) {
    for (int i = 1; i < MAX_PROCESSES; i++) {
        if (process_table[i].state == PROC_STATE_TERMINATED || process_table[i].pid == 0) {
            process_table[i].pid = i;
            process_table[i].state = PROC_STATE_READY;
            process_table[i].required_capability = cap;
            strncpy(process_table[i].name, name, 15);
            return i;
        }
    }
    return -1; // Table full
}

pcb_t* process_get_current(void) {
    return &process_table[current_pid];
}
