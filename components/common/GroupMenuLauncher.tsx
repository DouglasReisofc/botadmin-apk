"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "react-bootstrap";
import { IconHelpCircle, IconMenu2 } from "@tabler/icons-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { GroupMiniViewKey } from "components/bot/UserGroupManager";
import { GROUP_MINI_VIEW_OPTIONS } from "components/bot/UserGroupManager";

const clampValue = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const GROUP_MANAGEMENT_PATH = "/dashboard/user?section=conversations";
const GROUP_MANAGEMENT_BASE_PATH = "/dashboard/user";
const MIN_TOP = 16;
const MIN_LEFT = 16;

type DragState = {
  pointerId: number | null;
  startX: number;
  startY: number;
  originTop: number;
  originLeft: number;
  moved: boolean;
  capture: boolean;
};

const DEFAULT_STATE: DragState = {
  pointerId: null,
  startX: 0,
  startY: 0,
  originTop: 0,
  originLeft: 0,
  moved: false,
  capture: false,
};

type Props = {
  visible?: boolean;
};

const GroupMenuLauncher = ({ visible = true }: Props) => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<DragState>({ ...DEFAULT_STATE });
  const overscrollRestoreRef = useRef<{ body: string; html: string } | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: 120,
    left: 0,
  });
  const positionKey = "group-menu-launcher-pos";
  const [pickerOpen, setPickerOpen] = useState(false);
  const [helpOption, setHelpOption] = useState<GroupMiniViewKey | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const width = buttonRef.current?.offsetWidth ?? 56;
    const initialLeft = Math.max(MIN_LEFT, window.innerWidth - width - 24);
    let restored: { top: number; left: number } | null = null;
    try {
      const raw = localStorage.getItem(positionKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.top === "number" && typeof parsed?.left === "number") {
          restored = {
            top: clampValue(parsed.top, MIN_TOP, window.innerHeight - 72),
            left: clampValue(parsed.left, MIN_LEFT, window.innerWidth - width - 16),
          };
        }
      }
    } catch {
      /* ignore */
    }
    setPosition((prev) => ({
      top: restored?.top ?? prev.top,
      left: restored?.left ?? initialLeft,
    }));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleResize = () => {
      const width = buttonRef.current?.offsetWidth ?? 56;
      const maxLeft = Math.max(MIN_LEFT, window.innerWidth - width - 16);
      setPosition((prev) => ({
        top: clampValue(prev.top, MIN_TOP, window.innerHeight - 72),
        left: clampValue(prev.left, MIN_LEFT, maxLeft),
      }));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(positionKey, JSON.stringify(position));
    } catch {
      /* ignore */
    }
  }, [position]);

  const dispatchToggle = (action: "toggle" | "open" | "close", view?: GroupMiniViewKey) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("group-menu-toggle", { detail: { action, view } }));
  };

  const clampPosition = (top: number, left: number) => {
    if (typeof window === "undefined") {
      return { top, left };
    }
    const width = buttonRef.current?.offsetWidth ?? 56;
    const height = buttonRef.current?.offsetHeight ?? 56;
    const maxLeft = Math.max(MIN_LEFT, window.innerWidth - width - 16);
    const maxTop = Math.max(MIN_TOP, window.innerHeight - height - 16);
    return {
      top: clampValue(top, MIN_TOP, maxTop),
      left: clampValue(left, MIN_LEFT, maxLeft),
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!visible || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (typeof document !== "undefined" && overscrollRestoreRef.current === null) {
      overscrollRestoreRef.current = {
        body: document.body.style.overscrollBehavior || "",
        html: document.documentElement.style.overscrollBehavior || "",
      };
      document.body.style.overscrollBehavior = "contain";
      document.documentElement.style.overscrollBehavior = "contain";
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originTop: position.top,
      originLeft: position.left,
      moved: false,
      capture: false,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragRef.current;
    if (!visible || state.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved && Math.hypot(dx, dy) > 5) {
      state.moved = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
        state.capture = true;
      } catch {
        /* ignore */
      }
    }
    if (state.moved) {
      event.preventDefault();
      event.stopPropagation();
      setPosition(clampPosition(state.originTop + dy, state.originLeft + dx));
    }
  };

  const finalizePointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragRef.current;
    if (state.pointerId !== event.pointerId) {
      return;
    }
    if (state.capture && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const wasDrag = state.moved;
    dragRef.current = { ...DEFAULT_STATE };
    if (!wasDrag) {
      setPickerOpen(true);
    }
    if (typeof document !== "undefined" && overscrollRestoreRef.current !== null) {
      document.body.style.overscrollBehavior = overscrollRestoreRef.current.body;
      document.documentElement.style.overscrollBehavior = overscrollRestoreRef.current.html;
      overscrollRestoreRef.current = null;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  useEffect(() => {
    if (!pathname?.startsWith(GROUP_MANAGEMENT_BASE_PATH)) {
      return;
    }
    if (searchParams?.get("openMenu") === "1") {
      dispatchToggle("open");
      router.replace(GROUP_MANAGEMENT_PATH, { scroll: false });
    }
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!visible) {
      setPickerOpen(false);
    }
  }, [visible]);

  useEffect(() => {
    setPickerOpen(false);
    setHelpOption(null);
  }, [pathname]);

  const handleSelectOption = (view: GroupMiniViewKey) => {
    setPickerOpen(false);
    setHelpOption(null);
    if (pathname?.startsWith(GROUP_MANAGEMENT_BASE_PATH)) {
      dispatchToggle("open", view);
      return;
    }
    router.push(GROUP_MANAGEMENT_PATH);
  };

  if (!visible) {
    return null;
  }

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="primary"
        className="group-quick-launcher shadow-lg rounded-circle"
        style={{ top: position.top, left: position.left, touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finalizePointer}
        onPointerCancel={finalizePointer}
        aria-label="Abrir atalhos do grupo"
      >
        <IconMenu2 size={22} />
      </Button>
      <Modal show={pickerOpen} onHide={() => setPickerOpen(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Atalhos rápidos</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-2">
          {GROUP_MINI_VIEW_OPTIONS.map((option) => (
            <div key={option.key} className="d-flex gap-2 align-items-center">
              <Button
                variant={option.variant}
                className="d-flex align-items-center gap-2 justify-content-start flex-grow-1"
                onClick={() => handleSelectOption(option.key)}
              >
                <span className="d-inline-flex align-items-center justify-content-center">
                  {option.icon}
                </span>
                <span className="fw-semibold text-wrap">{option.label}</span>
              </Button>
              <Button
                variant="outline-secondary"
                className="desktop-group-manager__button-help"
                onClick={() => setHelpOption(option.key)}
                aria-label={`Saiba mais sobre ${option.label}`}
              >
                <IconHelpCircle size={16} />
              </Button>
            </div>
          ))}
        </Modal.Body>
      </Modal>
      <Modal show={Boolean(helpOption)} onHide={() => setHelpOption(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {GROUP_MINI_VIEW_OPTIONS.find((option) => option.key === helpOption)?.label ?? "Atalho"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-0 text-secondary">
            {GROUP_MINI_VIEW_OPTIONS.find((option) => option.key === helpOption)?.description}
          </p>
        </Modal.Body>
      </Modal>
    </>
  );
};

export default GroupMenuLauncher;
