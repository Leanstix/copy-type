#define _GNU_SOURCE
#include <dlfcn.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct _GIRepository GIRepository;
typedef void (*PrependPath)(GIRepository *, const char *);

static char runtime_dir[PATH_MAX];

static void __attribute__((constructor))
initialize_runtime(void)
{
    Dl_info info;
    if (!dladdr((void *)initialize_runtime, &info) || !realpath(info.dli_fname, runtime_dir)) {
        fputs("CopyType could not resolve the GNOME runtime directory.\n", stderr);
        abort();
    }
    *strrchr(runtime_dir, '/') = '\0';

    /* The loader has already read these values for GNOME Shell. Ordinary
       applications spawned by Shell must start with the host loader paths. */
    unsetenv("LD_PRELOAD");
    unsetenv("LD_LIBRARY_PATH");
}

static void
prepend_path(const char *symbol, GIRepository *repository, const char *directory)
{
    PrependPath prepend = (PrependPath)dlsym(RTLD_NEXT, symbol);
    if (!prepend) {
        fprintf(stderr, "CopyType could not resolve %s.\n", symbol);
        abort();
    }

    /* GNOME Shell explicitly prepends the packaged Mutter directory. Keep
       the matching patched libraries and their typelibs together. */
    prepend(repository, strcmp(directory, STOCK_MUTTER_DIR) == 0 ? runtime_dir : directory);
}

void
gi_repository_prepend_search_path(GIRepository *repository, const char *directory)
{
    prepend_path("gi_repository_prepend_search_path", repository, directory);
}

void
gi_repository_prepend_library_path(GIRepository *repository, const char *directory)
{
    prepend_path("gi_repository_prepend_library_path", repository, directory);
}
