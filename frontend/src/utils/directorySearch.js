export const DIRECTORY_EXTENSION_DIGITS =
  import.meta.env.VITE_DIRECTORY_EXTENSION_DIGITS === '5' ? 5 : 4

/** Kiểm tra điều kiện tìm trước khi tạo request từ danh bạ hoặc modal mời. */
export function directorySearchHint(field, term) {
  if (!term) return ''
  if (field === 'extension' && (!/^\d+$/.test(term) || term.length !== DIRECTORY_EXTENSION_DIGITS))
    return `Nhập đúng ${DIRECTORY_EXTENSION_DIGITS} chữ số máy lẻ.`
  return term.length < 2 ? 'Nhập ít nhất 2 ký tự để tìm.' : ''
}
