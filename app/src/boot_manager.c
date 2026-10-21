#include "boot_manager.h"
#include "storage.h"
#include <zephyr/logging/log.h>

LOG_MODULE_REGISTER(os_boot, LOG_LEVEL_INF);

static BootState boot_state;
#define BOOT_STATE_PATH "/config/boot"

int boot_manager_init(void) {
    storage_read(BOOT_STATE_PATH, &boot_state, sizeof(BootState));
    
    if (boot_state.crash_count > 3) {
        boot_state.recovery_mode = 1;
        LOG_WRN("High crash count detected! Entering Recovery Mode.");
    }
    
    boot_state.crash_count++;
    storage_write(BOOT_STATE_PATH, &boot_state, sizeof(BootState));
    return 0;
}

void boot_manager_report_success(void) {
    boot_state.crash_count = 0;
    boot_state.last_boot_ok = 1;
    storage_write(BOOT_STATE_PATH, &boot_state, sizeof(BootState));
    LOG_INF("System boot verified.");
}

void boot_manager_report_failure(void) {
    boot_state.last_boot_ok = 0;
    storage_write(BOOT_STATE_PATH, &boot_state, sizeof(BootState));
}

bool boot_manager_in_recovery(void) {
    return boot_state.recovery_mode != 0;
}
