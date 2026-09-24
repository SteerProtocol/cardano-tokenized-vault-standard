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

-- Keep each reference anchor on the page where its numbered entry starts.
function Div(el)
  if FORMAT:match('latex') and el.identifier:match('^ctvs%d+%-ref%-%d+$') then
    return {pandoc.RawBlock('latex', '\\Needspace{5\\baselineskip}'), el}
  end
end
