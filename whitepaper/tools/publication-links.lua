-- PDF artifacts live in output/, one directory below the Markdown sources.
-- Keep source-relative links readable in Markdown and resolve them from the PDF.
function Link(el)
  if FORMAT:match('latex') and not el.target:match('^#')
      and not el.target:match('^[%a][%w+.-]*:')
      and not el.target:match('^/') then
    el.target = '../' .. el.target
  end
  return el
end
