"""Keep internal PDF navigation intact when combining separately typeset papers."""
import fitz


def resolve_named_links(document):
    # insert_pdf does not copy named destinations. Resolve them before merging.
    destinations = document.resolve_names()
    for page in document:
        for link in page.get_links():
            name = link.get('nameddest')
            if not name:
                continue
            target = destinations.get(name)
            if target is None or target.get('page', -1) < 0:
                raise ValueError(f'Unresolved PDF destination: {name}')
            target_page = document[target['page']]
            # resolve_names returns PDF coordinates; update_link uses page coordinates.
            point = fitz.Point(target['to']) * target_page.transformation_matrix
            page.update_link({
                'kind': fitz.LINK_GOTO,
                'xref': link['xref'],
                'from': link['from'],
                'page': target['page'],
                'to': point,
                'zoom': target.get('zoom', 0),
            })
