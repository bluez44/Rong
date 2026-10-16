import { createContext, Fragment, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

type HostApi = {
  mount: (id: string, node: ReactNode) => void;
  unmount: (id: string) => void;
};

const SheetHostContext = createContext<HostApi | null>(null);

/**
 * Lớp phủ ở gốc nhóm màn `(app)`, nơi các bottom sheet được vẽ. Nhờ vậy sheet khai báo
 * sâu trong nội dung cuộn (ví dụ trình sửa lịch trình) vẫn phủ cả màn hình mà không cần
 * `Modal`. Đặt bên trong các provider mà nội dung sheet dùng (`useAuth`, `useSavedPlaces`).
 */
export function SheetHost({ children }: { children: ReactNode }) {
  const [sheets, setSheets] = useState<ReadonlyMap<string, ReactNode>>(new Map());
  const api = useMemo<HostApi>(
    () => ({
      mount: (id, node) => setSheets((prev) => new Map(prev).set(id, node)),
      unmount: (id) =>
        setSheets((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        }),
    }),
    [],
  );

  return (
    <SheetHostContext.Provider value={api}>
      {children}
      {sheets.size > 0 ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {[...sheets].map(([id, node]) => (
            <Fragment key={id}>{node}</Fragment>
          ))}
        </View>
      ) : null}
    </SheetHostContext.Provider>
  );
}

/** Đưa `children` lên `SheetHost`; gỡ ra khi component này unmount. */
export function SheetPortal({ children }: { children: ReactNode }) {
  const host = useContext(SheetHostContext);
  const id = useId();
  if (!host) throw new Error('SheetPortal phải nằm trong SheetHost');

  useEffect(() => {
    host.mount(id, children);
  }, [host, id, children]);
  useEffect(() => () => host.unmount(id), [host, id]);
  return null;
}
