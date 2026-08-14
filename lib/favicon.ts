// A self-contained icon prevents browsers from probing the hosting origin root.
export const FAVICON_HREF =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2064%2064'%3E%3Crect%20width='64'%20height='64'%20rx='12'%20fill='%230f1115'/%3E%3Cpath%20d='M17%2018h30v8H25v6h18v8H25v6h22v8H17z'%20fill='%2378b3ff'/%3E%3C/svg%3E";

export const FAVICON_LINK =
  `<link rel="icon" href="${FAVICON_HREF}" type="image/svg+xml">`;
