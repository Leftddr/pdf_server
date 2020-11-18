import textract
import sys
import json
import mimetypes
from elasticsearch import Elasticsearch
from elasticsearch import helpers
import copy
import urllib.request
import requests
import xml.etree.ElementTree as elemTree

#큰 제목을 위한것
pdf_title = []
#소제목을 위한것
pdf_small_title = []
#내용을 위한것
pdf_content = []
small_len_for_sentence = 15
es = None #ElasticSearch를 위한것

json_for_pdf = dict()

#네이버 언어감지를 위한 key
naver_client_id = "XtaunbyuK4kKKVK7iHOv"
naver_client_secret = "HexFLNsvfe"
#네이버 검색 api_key
naver_search_id = "0gtTaRyZDxxtlsxPvhn2"
naver_search_secret = "UuljAklNy_"
#카카오 번역을 위한 key
kakao_api_key = "af35956434233a16d98f0c2170840ca3"

def check_type(filename):
    if mimetypes.guess_type(sys.argv[1]) == ('application/pdf', None):
        return 1
    else:
        return 0

def check_small_title(small_title):
    for i in range(len(small_title) - 1, -1, -1):
        if i >= 0 and small_title[i] >= '1' and small_title[i] <= '9': #소제목은 거의 1 introduction 이렇게 되어있다.
            if small_title[i + 1] == ' ' and small_title[i + 2] >= 'A' and small_title[i + 2] <= 'Z':
                return 1 #진짜 소제목의 pattern이 맞는지 구별하는 것
            else:
                return 0

def add_small_title():
    pdf_small_title.insert(0, "Abstract")
    pdf_small_title.append('Acknowledgement')
    pdf_small_title.append('References')

def sort_small_title(): #소제목들을 순서대로 정렬하기 위한것.. parsing이 순서대로 되지 않기때문..
    pdf_small_title.sort()

def erase_blank_space(text): #앞부분에 공백을 지우기 위한것
    while text[0] != ' ' and text[0] != '%':
        text = text[1 : len(text)]
    return text

def make_json(txt_pdf):
    ft_json = json.dumps(txt_pdf, indent = 4)
    return ft_json

def textract_for_title(text):
    text = text.decode()
    for_title = False
    tmp_str = ''
    tmp_last_num_index = -1
    for index, text_char in enumerate(text):
        if index - 1 >= 0 and text[index - 1] == '\n' and (text_char >= '1' and text_char <= '9') and for_title == False: #소제목은 거의 1 introduction 이렇게 되어있다.
            for_title = True
        if for_title:
            tmp_str += text_char
            '''
            if text_char != '.' and text_char != ' ' and ((text_char < 'a' or text_char > 'z') and (text_char < 'A' or text_char > 'Z') and (text_char < '1' or text_char > '9')) and text_char != '\n':
                for_title = False
                tmp_str = ''
                continue 
            ''' # 소제목에 어떤 문자가 들어가 있을지 모르므로 일단 뺐다.
            if text_char == '\n':
                tmp_str = tmp_str[0:-1]
                if tmp_str[-1] >= 'a' and tmp_str[-1] <= 'z' and check_small_title(tmp_str) == 1:
                    pdf_small_title.append(tmp_str)
                tmp_str = ''
                for_title = False

def textract_for_big_title(text):
    text = text.decode()

    tmp_str = ''
    text = text.replace('\n', '%')
    #우선 구분을 위해 '\n'을 '%'로 구분한다.
    #제목을 parsing 한다 (\n 과 대문자로 구분).
    #문자을 parsing 한다 (.으로 대문자로 구분).
    for index, text_char in enumerate(text):
        if text_char == '%' and (((text[index + 1] >= 'A' and text[index + 1] <= 'Z') and (text[index - 1] >= 'a' and text[index - 1] <= 'z'))): #Libnvmio : ~~~~~~~ \n Lib
            if len(pdf_title) == 0:
                pdf_title.append(tmp_str) #첫번째 큰제목을 위한 것
                return
            tmp_str = ''
        else:
            if text_char == '%':
                tmp_str += ' '
            else:
                tmp_str += text_char

def textract_split_not_reference(small_title, text, start_index, title_index): #reference가 아닌 문장을 분리한다.
    end_index = text.find(pdf_small_title[title_index + 1])
    text = text.replace('\n', '%') #편의를 위해 \n을 %로 바꾸어준다.
    tmp_str = ''

    json_for_pdf[pdf_title[0]][small_title] = []

    for index in range(start_index, end_index):
        if text[index] == '.' and ((text[index + 2] >= 'A' and text[index + 2] <= 'Z') or (text[index + 1] == '%')):
            tmp_str = erase_blank_space(tmp_str)
            if len(tmp_str) > small_len_for_sentence:
                json_for_pdf[pdf_title[0]][small_title].append(tmp_str)
            tmp_str = ''
        else:
            if text[index] == '%':
                tmp_str += ' '
            else:
                tmp_str += text[index]   


def textract_split_reference(small_title, text, start_index, title_index): #reference 인것은 대게 [25] 형태이므로 이렇게 쓴다.
    end_index = len(text)
    text = text.replace('\n', '%')
    tmp_str = ''

    json_for_pdf[pdf_title[0]][small_title] = []

    for index in range(start_index, end_index):
        if text[index] == '[':
            erase_blank_space(tmp_str)
            json_for_pdf[pdf_title[0]][small_title].append(tmp_str)
            tmp_str = ''
            tmp_str += text[index]
        else:
            if text[index] == '%':
                tmp_str += ' '
            else:
                tmp_str += text[index]
    
    json_for_pdf[pdf_title[0]][small_title].append(tmp_str) # [을 기준으로 하였기 때문에 마지막으로 처리 못한 str을 붙이는것

def connect_to_elastic():
    global es

    es = Elasticsearch('localhost:9200')

def make_index(index_name):
    global es

    if es.indices.exists(index = index_name):
        es.indices.delete(index = index_name)
    es.indices.create(index = index_name)

def searchAPI(index_name, query):
    global es
    
    res = es.search(index = index_name, body = query) #query를 던진다.
    return res

#언어를 감지하는 코드이다
def naver_check_language(txt):
    encQuery = urllib.parse.quote(txt)
    data = "query=" + encQuery

    url = "https://openapi.naver.com/v1/papago/detectLangs"

    request = urllib.request.Request(url)
    request.add_header("X-Naver-Client-Id", naver_client_id)
    request.add_header("X-Naver-Client-Secret", naver_client_secret)

    try:
        response = urllib.request.urlopen(request, data = data.encode("utf-8"))
        rescode = response.getcode()
        if(rescode == 200):
            response_body = json.loads(response.read())
            language = response_body['langCode']
            return language
        else:
            print('Error Code : ' + rescode)
        
    except urllib.error.HTTPError as e:
        print(e.code)
        print(e.read())
    return None

def kakao_check_language(txt):

    encQuery = urllib.parse.quote(txt)
    data = "query=" + encQuery

    url = 'https://dapi.kakao.com/v2/translation/language/detect'
    request = urllib.request.Request(url)
    request.add_header("Authorization", "KakaoAK " + kakao_api_key)

    try:
        response = urllib.request.urlopen(request, data = data.encode("utf-8"))
        rescode = response.getcode()
        if(rescode == 200):
            response_body = json.loads(response.read())
            src = response_body['language_info']['code']
            return src
        else:
            print('Error Code : ' + rescode)

    except urllib.error.HTTPError as e:
        print(e.code)
        print(e.read())

    return None

#네이버 번역 api
def naver_translate_language(txt, src):
    encText = urllib.parse.quote(txt)
    data = "source=" + src + "&target=ko&text=" + encText

    url = "https://openapi.naver.com/v1/papago/n2mt"

    request = urllib.request.Request(url)
    request.add_header("X-Naver-Client-Id", naver_client_id)
    request.add_header("X-Naver-Client-Secret", naver_client_secret)

    try:
        response = urllib.request.urlopen(request, data = data.encode("utf-8"))
        rescode = response.getcode()
        if rescode == 200:
            response_body = json.loads(response.read())
            #response_body = response_body.decode('utf-8')
            return response_body['message']['result']['translatedText']
        else:
            print("Error Code : " + rescode)

    except urllib.error.HTTPError as e:
        print(e.code)
        print(e.read().decode('utf-8'))
    return None

def kakao_translate_language(txt, src):
    encText = urllib.parse.quote(txt)
    data = "src_lang=" + src + "&target_lang=kr&" + "query=" + encText

    url = "https://dapi.kakao.com/v2/translation/translate"

    request = urllib.request.Request(url)
    request.add_header("Authorization", "KakaoAK " + kakao_api_key)

    try:
        response = urllib.request.urlopen(request, data = data.encode("utf-8"))
        rescode = response.getcode()
        if rescode == 200:
            response_body = json.loads(response.read())
            return response_body['translated_text'][0][0]
        else:
            print("Error Code : " + rescode)

    except urllib.error.HTTPError as e:
        print(e.code)
        print(e.read().decode('utf-8'))

    return None

def naver_search(txt):
    encText = urllib.parse.quote(txt)
    url = "https://openapi.naver.com/v1/search/encyc.xml?"
    url = url + "query=" + encText + "&display=5" + "&start=1" + "&sort=sim"

    request = urllib.request.Request(url)
    request.add_header("X-Naver-Client-Id", naver_search_id)
    request.add_header("X-Naver-Client-Secret", naver_search_secret)

    dict_for_result = {}

    try:
        response = urllib.request.urlopen(request)
        rescode = response.getcode()
        if rescode == 200:
            tree = elemTree.parse(response)
            channel = tree.find('channel')
            item = channel.find('item')
            for idx, it in enumerate(item):
                dict_for_result[item.find('title').text] = item.find('description').text
            with open('./search.json', 'w', encoding = 'UTF-8-sig') as json_file:
                json.dump(dict_for_result, json_file, ensure_ascii = False)
        else:
            print("Error Code : " + rescode)

    except urllib.error.HTTPError as e:
        print(e.code)
        print(e.read().decode('utf-8'))

def naver_search_paper(txt):
    encText = urllib.parse.quote(txt)
    url = "https://openapi.naver.com/v1/search/doc.json?"
    url = url + "query=" + encText + "&display=10" + "&start=1" + "&sort=sim"

    request = urllib.request.Request(url)
    request.add_header("X-Naver-Client-Id", naver_search_id)
    request.add_header("X-Naver-Client-Secret", naver_search_secret)

    dict_for_result = {}

    try:
        response = urllib.request.urlopen(request)
        rescode = response.getcode()
        if rescode == 200:
            response_body = json.loads(response.read())
            item = response_body['items']
            for it in item:
                dict_for_result[it['title']] = it['description']
            with open('./search_paper.json', 'w', encoding = 'UTF-8-sig') as json_file:
                json.dump(dict_for_result, json_file, ensure_ascii = False)
        else:
            print("Error Code : " + rescode)

    except urllib.error.HTTPError as e:
        print(e.code)
        print(e.read().decode('utf-8'))


if __name__ == '__main__':
    #이 코드는 논문 번역시 혹은 단어 검색시 모르는 단어를 검색하기 위한것
    if sys.argv[1] == 'search':
        #python3 textract.py search "sentence" or "word"
        naver_search(sys.argv[2])
        sys.exit(1)
    if sys.argv[1] == 'paper':
        #python3 textract.py paper "sentence" or "word"
        naver_search_paper(sys.argv[2])
        sys.exit(1)
    
    if check_type(sys.argv[1]):
        #미리 연결후 index가 있으면 원본과 번역본이 있는 걸로 판단하고 돌아가기 위해 바로 연결한다.
        connect_to_elastic()

        #여기서 부터는 elastic-search에 넣기 위한 코드이다.
        #/로 구분지어준다.
        #atc-choi.pdf에서 .pdf를 지워준다.
        index_name = sys.argv[1].split('/')
        index_name = index_name[len(index_name) - 1][:-4]
        tranlated_index_name = "translated_" + index_name

        #인덱스가 있으면 이미 elastic-server에 있는 걸로 판단.
        if es.indices.exists(tranlated_index_name):
            print("Already Existed")
            sys.exit(1)

        text = textract.process(sys.argv[1]) #텍스트로 바꾸기
        textract_for_title(text)
        sort_small_title()
        add_small_title()
        textract_for_big_title(text)
        json_for_pdf[pdf_title[0]] = dict() #큰제목이 가장 큰 index가 되어진다.
        text = text.decode()
        for i in range(len(pdf_small_title)):
            if pdf_small_title[i] != 'References':
                textract_split_not_reference(pdf_small_title[i], text, text.find(pdf_small_title[i]) + len(pdf_small_title[i]), i)
            else:
                textract_split_reference(pdf_small_title[i], text, text.find(pdf_small_title[i]) + len(pdf_small_title[i]), i)

        json_for_translated_pdf = copy.deepcopy(json_for_pdf)

        #번역하기 위한 횟수를 정한다.
        translated_num = 0
        
        for title in json_for_translated_pdf:
            for small_title in json_for_translated_pdf[title]:
                for idx, content in enumerate(json_for_translated_pdf[title][small_title]):
                    src = naver_check_language(content)
                    translated_text = naver_translate_language(content, src)
                    json_for_translated_pdf[title][small_title][idx] = translated_text
                    translated_num += 1
                    #15 문장의 번역이 끝나면 바로 for문을 종료한다.
                    if translated_num > 20:
                        break
                if translated_num > 20:
                    break
            if translated_num > 20:
                break
                

        #원본 pdf를 집어넣는다.
        make_index(index_name)
        es.index(index = index_name, doc_type = 'example1', body = make_json(json_for_pdf))
        es.indices.refresh(index = index_name)
        #번역된 pdf를 집어넣는다.
        make_index(tranlated_index_name)
        es.index(index = tranlated_index_name, doc_type = 'example1', body = make_json(json_for_translated_pdf))
        es.indices.refresh(index = tranlated_index_name)
        print('translate & transfer complete')
        #print(json_for_translated_pdf)
    else:
        print('Not PDF Type')
        sys.exit(1)
    
