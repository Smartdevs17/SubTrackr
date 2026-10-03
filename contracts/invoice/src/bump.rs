//! Bump allocator for the invoice contract's off-chain data helpers.
//!
//! The invoice renderer and the jurisdiction-key builder assemble plain host
//! strings before handing them to the SDK, which needs a global allocator to
//! do that on a bare-metal `wasm` target. Soroban gives the contract a memory
//! budget but no allocator, so this module installs a minimal bump allocator.
//!
//! It never reuses memory: every allocation carves bytes off a static arena
//! and leaves them until the contract instance is discarded. That is
//! acceptable here because both callers build one bounded document per call
//! and release it when the instance ends, but it would not be for a hot path
//! that loops.

#[cfg(target_arch = "wasm32")]
mod wasm_allocator {
    use core::alloc::{GlobalAlloc, Layout};
    use core::cell::UnsafeCell;
    use core::ptr;

    /// Size of the static arena backing every allocation in this contract.
    const ARENA_SIZE: usize = 512 * 1024;

    /// Alignment that satisfies `i128`, the widest type we store.
    const ARENA_ALIGN: usize = 16;

    #[repr(C, align(16))]
    struct Arena([u8; ARENA_SIZE]);

    impl Arena {
        const fn new() -> Self {
            Arena([0; ARENA_SIZE])
        }
    }

    /// Bump cursor. Starts at the end of the arena and moves down, so a null
    /// pointer is never handed out.
    struct Offset(UnsafeCell<usize>);

    // SAFETY: a Soroban contract instance is single-threaded, so the cursor
    // needs no synchronisation.
    unsafe impl Sync for Offset {}

    static OFFSET: Offset = Offset(UnsafeCell::new(ARENA_SIZE));

    pub struct BumpAllocator;

    // SAFETY: `OFFSET` is thread-local, so each wasm instance bumps its own
    // cursor. Bump allocation never frees, so there is no aliasing risk: every
    // returned range is disjoint from all previously returned ones.
    unsafe impl GlobalAlloc for BumpAllocator {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            let align = layout.align().max(ARENA_ALIGN);
            let size = layout.size();

            let offset = unsafe { &mut *OFFSET.0.get() };
            {
                let current = unsafe { *offset };

                // Reserve the extra align-1 bytes needed to round the start up
                // to `align`, plus `size` for the object itself.
                let Some(start) = current.checked_sub(size + (align - 1)) else {
                    return ptr::null_mut();
                };
                let aligned = (start + (align - 1)) & !(align - 1);

                // Growing down means `aligned + size` must stay inside the
                // arena and below the previous cursor.
                if aligned < ARENA_SIZE && aligned + size <= current {
                    unsafe { *offset = aligned };
                    aligned as *mut u8
                } else {
                    ptr::null_mut()
                }
            }
        }

        unsafe fn dealloc(&self, _ptr: *mut u8, _layout: Layout) {
            // Bump allocation: memory is reclaimed with the contract instance.
        }
    }
}

#[cfg(target_arch = "wasm32")]
#[global_allocator]
static GLOBAL: wasm_allocator::BumpAllocator = wasm_allocator::BumpAllocator;
